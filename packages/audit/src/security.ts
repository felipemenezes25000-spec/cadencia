import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Pool } from 'pg';
import type { AuditMeta, AuditOutcome } from './domain';

export interface SecurityAuditEvent {
  readonly eventType: string;
  readonly outcome: AuditOutcome;
  readonly entitySchema: string;
  readonly entityTable: string;
  readonly entityId?: string | null;
  readonly tenantId?: string | null;
  readonly clinicId?: string | null;
  readonly actorUserId?: string | null;
  readonly actorKind: 'user' | 'system' | 'anon';
  readonly sessionId?: string | null;
  readonly requestId?: string | null;
  readonly ip?: string | null;
  readonly meta?: AuditMeta;
}

export interface SecurityAuditChannelOptions {
  /** Conexão do pool DEDICADO. Nunca a mesma do pool de negócio. */
  readonly connectionString: string;
  /** Arquivo NDJSON de contingência, em volume persistente da task. */
  readonly bufferPath: string;
  /** §2.1: 2 conexões. */
  readonly max?: number;
}

const SQL_LOG_SECURITY = `
  SELECT audit.log_security($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb) AS id`;

/**
 * Buffer em disco existe para banco indisponível — e só para isso.
 * SQLSTATE de constraint (23*), de dado (22*) ou de privilégio (42*) é bug nosso
 * e tem que falhar alto: bufferizar um `meta` recusado pela whitelist gravaria
 * queixa, CID ou nome de paciente em texto claro num arquivo NDJSON, que é
 * precisamente o que a NGS1.07.06 proíbe.
 */
function isTransient(err: unknown): boolean {
  const code = (err as { code?: unknown }).code;
  // Erro de rede/socket do Node (ECONNREFUSED, ETIMEDOUT) ou timeout do pool:
  // não tem SQLSTATE de 5 caracteres.
  if (typeof code !== 'string' || !/^[0-9A-Z]{5}$/.test(code)) return true;
  // 08 conexão · 53 recursos esgotados · 57 intervenção do operador ·
  // 58 erro de sistema · XX corrupção interna.
  return /^(08|53|57|58|XX)/.test(code);
}

/**
 * Canal B: segurança e acesso, FORA da transação de negócio.
 *
 * Evento de negação é o que o auditor procura, e a negação acontece exatamente
 * quando a transação de negócio vai abortar. Gravar pela mesma conexão faria o
 * ROLLBACK apagar a evidência. Se o banco recusar, o evento vai para disco.
 */
export class SecurityAuditChannel {
  private readonly pool: Pool;
  private readonly bufferPath: string;
  readonly maxConnections: number;

  constructor(options: SecurityAuditChannelOptions) {
    this.maxConnections = options.max ?? 2;
    this.bufferPath = options.bufferPath;
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: this.maxConnections,
      connectionTimeoutMillis: 2_000,
      application_name: 'cadencia-audit-channel',
      options: '-c role=app_rw',
    });
    // O papel de login `api` é NOINHERIT. Definir o papel no handshake evita que
    // o pool entregue a conexão enquanto uma query de inicialização ainda roda.
    this.pool.on('error', () => undefined);
  }

  /** Conexões físicas efetivamente abertas agora por este pool. */
  get openConnections(): number {
    return this.pool.totalCount;
  }

  async record(event: SecurityAuditEvent): Promise<'gravado' | 'bufferizado'> {
    try {
      await this.insert(event);
      return 'gravado';
    } catch (err) {
      if (!isTransient(err)) throw err;
      this.buffer(event);
      return 'bufferizado';
    }
  }

  /**
   * Leitura de prontuário. A deduplicação (1 evento por usuário × paciente ×
   * caso de uso, janela de 5 min) acontece no banco: dois processos api não
   * compartilham cache de memória.
   */
  async recordRead(read: {
    readonly useCase: string;
    readonly patientId: string;
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly clinicId?: string | null;
    readonly sessionId?: string | null;
    readonly requestId?: string | null;
  }): Promise<'gravado' | 'deduplicado' | 'bufferizado'> {
    try {
      const res = await this.pool.query<{ id: string | null }>(
        'SELECT audit.log_read($1,$2,$3,$4,$5,$6,$7) AS id',
        [
          read.useCase,
          read.patientId,
          read.tenantId,
          read.actorUserId,
          read.clinicId ?? null,
          read.sessionId ?? null,
          read.requestId ?? null,
        ],
      );
      return res.rows[0]?.id == null ? 'deduplicado' : 'gravado';
    } catch (err) {
      if (!isTransient(err)) throw err;
      this.buffer({
        eventType: 'PATIENT_RECORD_READ',
        outcome: 'sucesso',
        entitySchema: 'clin',
        entityTable: 'patient',
        entityId: read.patientId,
        tenantId: read.tenantId,
        actorUserId: read.actorUserId,
        actorKind: 'user',
        clinicId: read.clinicId ?? null,
        sessionId: read.sessionId ?? null,
        requestId: read.requestId ?? null,
        meta: { use_case: read.useCase },
      });
      return 'bufferizado';
    }
  }

  /** Reenvia o buffer de disco. Para no primeiro erro e preserva o restante. */
  async drain(): Promise<number> {
    if (!existsSync(this.bufferPath)) {
      return 0;
    }
    const linhas = readFileSync(this.bufferPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '');
    let enviados = 0;
    try {
      for (; enviados < linhas.length; enviados += 1) {
        await this.insert(JSON.parse(linhas[enviados] ?? '{}') as SecurityAuditEvent);
      }
    } finally {
      writeFileSync(
        this.bufferPath,
        linhas
          .slice(enviados)
          .map((l) => `${l}\n`)
          .join(''),
        'utf8',
      );
    }
    return enviados;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async insert(event: SecurityAuditEvent): Promise<void> {
    await this.pool.query(SQL_LOG_SECURITY, [
      event.eventType,
      event.outcome,
      event.entitySchema,
      event.entityTable,
      event.entityId ?? null,
      event.tenantId ?? null,
      event.clinicId ?? null,
      event.actorUserId ?? null,
      event.actorKind,
      event.sessionId ?? null,
      event.requestId ?? null,
      event.ip ?? null,
      JSON.stringify(event.meta ?? {}),
    ]);
  }

  private buffer(event: SecurityAuditEvent): void {
    mkdirSync(dirname(this.bufferPath), { recursive: true });
    appendFileSync(this.bufferPath, `${JSON.stringify(event)}\n`, 'utf8');
  }
}
