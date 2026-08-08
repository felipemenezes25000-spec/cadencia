### Task 12: Exportar `loadTussCompetenciaSafe` no barrel e teste de regressao com amostra de 100 termos

**Arquivos**
- Modificar: `packages/catalogs/src/tuss-load.int.test.ts`
- Verificar: `packages/catalogs/src/index.ts` (se existir, adicionar export)

O teste final confirma que o job funciona com volume realista (~100 termos), que a carga e idempotente em volume, e que `resolveTussAt` integra corretamente com termos carregados pelo novo fluxo.

- [ ] Verificar se `packages/catalogs/src/index.ts` existe e adicionar a exportacao. Se o arquivo existir, acrescentar:

```ts
export { loadTussCompetenciaSafe, type TussLoadInput, type TussLoadResult } from './tuss-load';
```

Se nao existir, criar o arquivo com:

```ts
// packages/catalogs/src/index.ts
export { resolveTussAt, type ResolvedTussTerm, type TussFailure } from './tuss';
export { loadTussCompetenciaSafe, type TussLoadInput, type TussLoadResult } from './tuss-load';
```

- [ ] Adicionar os testes de volume ao final de `packages/catalogs/src/tuss-load.int.test.ts`:

```ts
// Adicionar ao final do arquivo, DENTRO do describe existente, antes do fechamento });

  it('carrega 100 termos de amostra e tuss_at retorna todos corretamente', async () => {
    const sampleRows: Array<{ tabela: number; codigo: string; termo: string; acao: string }> = [];
    for (let i = 1; i <= 100; i++) {
      const codigo = String(80000000 + i).padStart(10, '0').slice(0, 10);
      sampleRows.push({
        tabela: TAB_PROCEDIMENTOS,
        codigo,
        termo: `Procedimento de volume ${i}`,
        acao: 'inclusao',
      });
    }

    const result = await loadTussCompetenciaSafe(jobsPool, {
      competencia: '202703',
      vigenciaFrom: '2029-01-01',
      vigenciaTo: null,
      rows: sampleRows,
    });

    expect(result.status).toBe('success');
    // 99 novos + 99990030 ja inserido na Task 10 = 100 no batch, mas 99990030 nao
    // esta no batch de 100 — sao 100 codigos novos da faixa 80000001..80000100
    expect(result.inserted).toBe(100);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(0);

    // Verificar uma amostra via tuss_at
    const { rows } = await admin.query<{ termo: string; competencia: string }>(
      `SELECT termo, competencia FROM ref.tuss_at($1::smallint, $2, $3::date)`,
      [TAB_PROCEDIMENTOS, '0080000050', '2030-01-01'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.termo).toBe('Procedimento de volume 50');
    expect(rows[0]!.competencia).toBe('202703');
  });

  it('recarga dos 100 termos e idempotente', async () => {
    const sampleRows: Array<{ tabela: number; codigo: string; termo: string; acao: string }> = [];
    for (let i = 1; i <= 100; i++) {
      const codigo = String(80000000 + i).padStart(10, '0').slice(0, 10);
      sampleRows.push({
        tabela: TAB_PROCEDIMENTOS,
        codigo,
        termo: `Procedimento de volume ${i}`,
        acao: 'inclusao',
      });
    }

    const result = await loadTussCompetenciaSafe(jobsPool, {
      competencia: '202703',
      vigenciaFrom: '2029-01-01',
      vigenciaTo: null,
      rows: sampleRows,
    });

    expect(result.status).toBe('success');
    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(100);
  });

  it('log acumula todas as execucoes para rastreabilidade', async () => {
    const { rows } = await admin.query<{ cnt: string }>(
      `SELECT count(*)::text AS cnt FROM ref.tuss_load_log
        WHERE competencia IN ('202701','202703')
          AND status = 'success'`,
    );
    // Deve ter pelo menos as execucoes das tasks anteriores
    expect(Number(rows[0]!.cnt)).toBeGreaterThanOrEqual(4);
  });
```

- [ ] Adicionar limpeza dos dados de volume no `afterAll`:

```ts
// Dentro do afterAll, adicionar ANTES do fechamento:
  await admin.query(
    `DELETE FROM ref.tuss_term
      WHERE competencia = '202703'
        AND codigo LIKE '00800%'`,
  );
```

- [ ] Rodar o teste completo e confirmar que tudo passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/catalogs/src/tuss-load.int.test.ts
```

Saida esperada: **PASS** — todos os testes verdes, incluindo carga de 100 termos, idempotencia em volume, e rastreabilidade do log.

- [ ] Rodar o teste existente de `tuss.int.test.ts` para confirmar que a carga original nao foi afetada:

```bash
pnpm vitest run packages/catalogs/src/tuss.int.test.ts
```

Saida esperada: **PASS** — os testes originais de terminologia versionada continuam verdes.

- [ ] Rodar todos os invariantes:

```bash
pnpm vitest run packages/db/src/invariants/
```

Saida esperada: todos os invariantes verdes.

- [ ] Commitar:

```bash
git add packages/catalogs/src/tuss-load.int.test.ts packages/catalogs/src/index.ts
git commit -m "test(catalogs): green — volume load 100 terms, idempotency, tuss_at integration

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```