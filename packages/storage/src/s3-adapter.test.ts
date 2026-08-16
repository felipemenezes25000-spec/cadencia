import { describe, expect, it, vi } from 'vitest';
import { S3StorageAdapter } from './s3-adapter';

const credentialsProvider = async () => ({
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secret-example',
  sessionToken: 'session-example',
});

describe('S3StorageAdapter', () => {
  it('assina PUT com SigV4 e exige SSE-KMS quando configurado', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(init?.method).toBe('PUT');
      expect(headers.get('authorization')).toContain('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/');
      expect(headers.get('x-amz-security-token')).toBe('session-example');
      expect(headers.get('x-amz-server-side-encryption')).toBe('aws:kms');
      expect(headers.get('x-amz-server-side-encryption-aws-kms-key-id')).toBe('arn:aws:kms:sa-east-1:123:key/abc');
      expect(headers.get('content-type')).toBe('application/pdf');
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const storage = new S3StorageAdapter({
      bucket: 'cadencia-prod',
      region: 'sa-east-1',
      kmsKeyId: 'arn:aws:kms:sa-east-1:123:key/abc',
      credentialsProvider,
      fetchImpl,
    });
    await storage.put('anexos/abc', new Uint8Array([1, 2, 3]), 'application/pdf');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('trata objeto ausente como null/false e delete como idempotente', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
    const storage = new S3StorageAdapter({
      bucket: 'cadencia-prod', region: 'sa-east-1', credentialsProvider, fetchImpl,
    });
    await expect(storage.get('anexos/nao-existe')).resolves.toBeNull();
    await expect(storage.exists('anexos/nao-existe')).resolves.toBe(false);
    await expect(storage.delete('anexos/nao-existe')).resolves.toBeUndefined();
  });

  it('recusa traversal em chave de objeto', async () => {
    const storage = new S3StorageAdapter({
      bucket: 'cadencia-prod', region: 'sa-east-1', credentialsProvider,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(storage.get('../segredo')).rejects.toThrow('storage key invalida');
  });
});
