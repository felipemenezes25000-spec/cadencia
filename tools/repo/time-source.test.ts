import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TIME_SOURCE_ALLOWLIST, listSourceFiles, scanTimeSource } from './time-source';

describe('fonte de tempo', () => {
  it('acusa Date.now() e new Date() com o numero da linha', () => {
    const fonte = ['const a = 1;', 'const t = Date.now();', 'const d = new Date();'].join('\n');
    const violacoes = scanTimeSource('packages/db/src/tx.ts', fonte);
    expect(violacoes).toHaveLength(2);
    expect(violacoes[0]?.line).toBe(2);
    expect(violacoes[1]?.line).toBe(3);
    expect(violacoes[0]?.file).toBe('packages/db/src/tx.ts');
  });

  it('nao acusa uso legitimo de tipo Date em assinatura', () => {
    expect(scanTimeSource('x.ts', 'function f(d: Date): number { return 0; }')).toEqual([]);
  });

  it('nenhum arquivo fora de kernel/clock.ts e kernel/uuid.ts le o relogio do sistema: o carimbo persistido vem do Postgres', () => {
    const arquivos = listSourceFiles(['packages', 'apps']).filter((f) => !TIME_SOURCE_ALLOWLIST.includes(f));
    const violacoes = arquivos.flatMap((arquivo) => scanTimeSource(arquivo, readFileSync(arquivo, 'utf8')));
    expect(violacoes.map((v) => `${v.file}:${v.line}`)).toEqual([]);
  });
});
