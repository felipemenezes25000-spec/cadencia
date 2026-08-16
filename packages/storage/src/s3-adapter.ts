import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { StorageAdapter } from './contract';

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

interface CachedCredentials {
  credentials: AwsCredentials;
  expiresAt: number;
}

let credentialCache: CachedCredentials | null = null;

const UTC_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export interface S3StorageOptions {
  bucket: string;
  region: string;
  kmsKeyId?: string;
  endpoint?: string;
  credentialsProvider?: () => Promise<AwsCredentials>;
  fetchImpl?: typeof fetch;
}

function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function encodeKey(key: string): string {
  if (key === '' || key.startsWith('/') || key.split('/').some((p) => p === '..')) {
    throw new Error('storage key invalida');
  }
  return key.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function wallClockMs(): number {
  // O projeto reserva leituras diretas do relogio do sistema ao kernel. Para
  // protocolo AWS precisamos de tempo de parede, nao de um carimbo persistido.
  // timeOrigin + relogio monotono preserva essa separacao e evita drift por
  // ajustes do relogio durante a vida do processo.
  return performance.timeOrigin + performance.now();
}

function amzTimestamp(epochMs: number): string {
  const parts: Record<string, string> = {};
  for (const part of UTC_PARTS.formatToParts(epochMs)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return `${parts['year']}${parts['month']}${parts['day']}T${parts['hour']}${parts['minute']}${parts['second']}Z`;
}

async function authorizationToken(): Promise<string | undefined> {
  const direto = process.env['AWS_CONTAINER_AUTHORIZATION_TOKEN'];
  if (direto !== undefined && direto !== '') return direto;
  const arquivo = process.env['AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE'];
  if (arquivo === undefined || arquivo === '') return undefined;
  return (await readFile(arquivo, 'utf8')).trim();
}

async function defaultCredentialsProvider(): Promise<AwsCredentials> {
  const accessKeyId = process.env['AWS_ACCESS_KEY_ID'];
  const secretAccessKey = process.env['AWS_SECRET_ACCESS_KEY'];
  if (accessKeyId && secretAccessKey) {
    return {
      accessKeyId,
      secretAccessKey,
      ...(process.env['AWS_SESSION_TOKEN'] ? { sessionToken: process.env['AWS_SESSION_TOKEN'] } : {}),
    };
  }

  const agora = wallClockMs();
  if (credentialCache !== null && credentialCache.expiresAt > agora + 5 * 60_000) {
    return credentialCache.credentials;
  }

  const relative = process.env['AWS_CONTAINER_CREDENTIALS_RELATIVE_URI'];
  const full = process.env['AWS_CONTAINER_CREDENTIALS_FULL_URI'];
  const url = full ?? (relative ? `http://169.254.170.2${relative}` : undefined);
  if (url === undefined) {
    throw new Error('credenciais AWS ausentes: use IAM Task Role no ECS');
  }

  const token = await authorizationToken();
  const response = await fetch(url, {
    ...(token ? { headers: { authorization: token } } : {}),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`falha ao obter credenciais do task role: HTTP ${response.status}`);

  const body = await response.json() as {
    AccessKeyId?: string;
    SecretAccessKey?: string;
    Token?: string;
    Expiration?: string;
  };
  if (!body.AccessKeyId || !body.SecretAccessKey) {
    throw new Error('resposta de credenciais AWS incompleta');
  }

  const credentials: AwsCredentials = {
    accessKeyId: body.AccessKeyId,
    secretAccessKey: body.SecretAccessKey,
    ...(body.Token ? { sessionToken: body.Token } : {}),
  };
  const expiresAt = body.Expiration ? Date.parse(body.Expiration) : agora + 30 * 60_000;
  credentialCache = { credentials, expiresAt };
  return credentials;
}

/**
 * Adaptador S3 sem dependencia de SDK: usa SigV4 sobre o `fetch` nativo do Node.
 * Em ECS as credenciais vem do IAM Task Role e sao renovadas antes de expirar.
 */
export class S3StorageAdapter implements StorageAdapter {
  private readonly endpoint: string;
  private readonly credentialsProvider: () => Promise<AwsCredentials>;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: S3StorageOptions) {
    if (options.bucket.trim() === '') throw new Error('bucket S3 obrigatorio');
    if (options.region.trim() === '') throw new Error('regiao S3 obrigatoria');
    this.endpoint = options.endpoint
      ?? `https://${options.bucket}.s3.${options.region}.amazonaws.com`;
    this.credentialsProvider = options.credentialsProvider ?? defaultCredentialsProvider;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request(
    method: 'PUT' | 'GET' | 'HEAD' | 'DELETE',
    key: string,
    data?: Uint8Array,
    contentType?: string,
  ): Promise<Response> {
    const encoded = encodeKey(key);
    const url = new URL(`${this.endpoint.replace(/\/$/, '')}/${encoded}`);
    const payload = data ?? new Uint8Array();
    const payloadHash = sha256Hex(payload);
    const amzDate = amzTimestamp(wallClockMs());
    const date = amzDate.slice(0, 8);
    const credentials = await this.credentialsProvider();

    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (contentType) headers['content-type'] = contentType;
    if (credentials.sessionToken) headers['x-amz-security-token'] = credentials.sessionToken;
    if (method === 'PUT' && this.options.kmsKeyId) {
      headers['x-amz-server-side-encryption'] = 'aws:kms';
      headers['x-amz-server-side-encryption-aws-kms-key-id'] = this.options.kmsKeyId;
    }

    const sortedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = sortedHeaderNames
      .map((name) => `${name}:${headers[name]!.trim().replace(/\s+/g, ' ')}\n`).join('');
    const signedHeaders = sortedHeaderNames.join(';');
    const canonicalRequest = [
      method,
      url.pathname,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const scope = `${date}/${this.options.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      sha256Hex(canonicalRequest),
    ].join('\n');
    const kDate = hmac(`AWS4${credentials.secretAccessKey}`, date);
    const kRegion = hmac(kDate, this.options.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    delete headers.host;

    return this.fetchImpl(url, {
      method,
      headers,
      ...(method === 'PUT' ? { body: Buffer.from(payload) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    const response = await this.request('PUT', key, data, contentType);
    if (!response.ok) throw new Error(`S3 PUT falhou: HTTP ${response.status}`);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const response = await this.request('GET', key);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`S3 GET falhou: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async exists(key: string): Promise<boolean> {
    const response = await this.request('HEAD', key);
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`S3 HEAD falhou: HTTP ${response.status}`);
    return true;
  }

  async delete(key: string): Promise<void> {
    const response = await this.request('DELETE', key);
    if (!response.ok && response.status !== 404) {
      throw new Error(`S3 DELETE falhou: HTTP ${response.status}`);
    }
  }
}
