### Task 21: tipos e contrato de resultado para `projectGuiaConsulta`

**Arquivos**

- Criar `packages/tiss/src/project-guia.ts`
- Teste `packages/tiss/src/project-guia.test.ts`

- [ ] **Passo 1 — escrever o teste de unidade dos tipos**

```bash
# nenhum arquivo existe ainda; o teste a seguir valida que a assinatura compila
```

Criar `packages/tiss/src/project-guia.test.ts`:

```ts
// packages/tiss/src/project-guia.test.ts
import { describe, expect, it } from 'vitest';
import type { ProjectionResult, ProjectionError } from './project-guia';
import { ok, err, isOk, isErr, type Result } from '@cadencia/kernel';

describe('tipos de projectGuiaConsulta', () => {
  it('Result.ok com projecao completa carrega guiaId e status completa', () => {
    const r: Result<ProjectionResult, ProjectionError> = ok({
      kind: 'projected',
      guiaId: '00000000-0000-0000-0000-000000000001',
      numeroGuia: '1',
      status: 'completa',
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.kind).toBe('projected');
      expect(r.value.status).toBe('completa');
    }
  });

  it('Result.ok com skip quando atendimento e particular', () => {
    const r: Result<ProjectionResult, ProjectionError> = ok({
      kind: 'skipped',
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.kind).toBe('skipped');
    }
  });

  it('Result.err com lista de campos ausentes quando dados obrigatorios faltam', () => {
    const r: Result<ProjectionResult, ProjectionError> = err({
      kind: 'dados_obrigatorios_ausentes',
      guiaId: '00000000-0000-0000-0000-000000000002',
      missingFields: ['numero_carteira', 'cnes'],
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.kind).toBe('dados_obrigatorios_ausentes');
      expect(r.error.missingFields).toContain('numero_carteira');
    }
  });

  it('Result.err com tuss_nao_vigente quando procedimento nao existe na TUSS', () => {
    const r: Result<ProjectionResult, ProjectionError> = err({
      kind: 'tuss_nao_vigente',
      codigoTabela: '22',
      codigoProcedimento: '10101012',
      dataAtendimento: '2026-08-01',
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.kind).toBe('tuss_nao_vigente');
    }
  });
});
```

- [ ] **Passo 2 — rodar e confirmar a falha (modulo nao existe)**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm test packages/tiss/src/project-guia.test.ts
```

Esperado: FALHA com erro de importacao — `./project-guia` exporta apenas `{}`.

- [ ] **Passo 3 — implementar os tipos**

Criar `packages/tiss/src/project-guia.ts`:

```ts
// packages/tiss/src/project-guia.ts
import type { Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// Resultado de sucesso
// ---------------------------------------------------------------------------

/** Guia projetada com sucesso (completa ou incompleta). */
export interface ProjectedResult {
  readonly kind: 'projected';
  readonly guiaId: string;
  readonly numeroGuia: string;
  readonly status: 'completa' | 'incompleta';
}

/** Atendimento particular — nenhuma guia projetada. */
export interface SkippedResult {
  readonly kind: 'skipped';
}

export type ProjectionResult = ProjectedResult | SkippedResult;

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

/** Dados obrigatorios da guia ausentes. A guia FOI criada com status incompleta. */
export interface DadosAusentesError {
  readonly kind: 'dados_obrigatorios_ausentes';
  readonly guiaId: string;
  readonly missingFields: readonly string[];
}

/** Procedimento nao existe na TUSS vigente na data do atendimento. */
export interface TussNaoVigenteError {
  readonly kind: 'tuss_nao_vigente';
  readonly codigoTabela: string;
  readonly codigoProcedimento: string;
  readonly dataAtendimento: string;
}

export type ProjectionError = DadosAusentesError | TussNaoVigenteError;

// ---------------------------------------------------------------------------
// Assinatura — implementacao nas proximas tarefas
// ---------------------------------------------------------------------------

export declare function projectGuiaConsulta(
  tx: TxClient,
  encounterId: string,
  encounterVersionId: string,
): Promise<Result<ProjectionResult, ProjectionError>>;
```

- [ ] **Passo 4 — rodar e confirmar que o teste de tipos passa**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm test packages/tiss/src/project-guia.test.ts
```

Esperado: PASSA (4 testes).

- [ ] **Passo 5 — atualizar o barrel export**

Editar `packages/tiss/src/index.ts`:

```ts
// packages/tiss/src/index.ts
export type {
  ProjectionResult, ProjectedResult, SkippedResult,
  ProjectionError, DadosAusentesError, TussNaoVigenteError,
} from './project-guia';
export { projectGuiaConsulta } from './project-guia';
```

- [ ] **Passo 6 — typecheck**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm typecheck
```

Esperado: PASSA.

- [ ] **Passo 7 — commitar**

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/tiss/src/project-guia.ts packages/tiss/src/project-guia.test.ts packages/tiss/src/index.ts
git commit -m "feat(tiss): add type contract for projectGuiaConsulta"
```

---