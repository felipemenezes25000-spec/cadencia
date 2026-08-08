### Task 7: Acoes de authz para TISS e teste do catalogo

**Arquivos**
- Modificar: `packages/authz/src/actions.ts`
- Criar: `packages/authz/src/actions-fase4.test.ts`

**Passos**

- [ ] Escrever o teste que falha em `packages/authz/src/actions-fase4.test.ts`:

```typescript
// packages/authz/src/actions-fase4.test.ts
import { describe, expect, it } from 'vitest';
import { ACTIONS, ACTION_BY_KEY } from './actions';

describe('acoes de TISS — Fase 4', () => {
  it('tiss.operadora.read existe e permite admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.operadora.read');
    expect(action).toBeDefined();
    expect(action!.roles).toContain('admin_clinico');
    expect(action!.roles).toContain('financeiro');
  });

  it('tiss.operadora.write existe e permite admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.operadora.write');
    expect(action).toBeDefined();
    expect(action!.roles).toContain('admin_clinico');
    expect(action!.roles).toContain('financeiro');
  });

  it('tiss.contrato.read existe e permite admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.contrato.read');
    expect(action).toBeDefined();
    expect(action!.roles).toContain('admin_clinico');
    expect(action!.roles).toContain('financeiro');
  });

  it('tiss.contrato.write existe e permite admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.contrato.write');
    expect(action).toBeDefined();
    expect(action!.roles).toContain('admin_clinico');
    expect(action!.roles).toContain('financeiro');
  });

  it('tiss.paciente_convenio.read existe e permite admin, profissional e recepcao', () => {
    const action = ACTION_BY_KEY.get('tiss.paciente_convenio.read');
    expect(action).toBeDefined();
    expect(action!.roles).toContain('admin_clinico');
    expect(action!.roles).toContain('profissional');
    expect(action!.roles).toContain('recepcao');
  });

  it('tiss.paciente_convenio.write existe e permite admin, profissional e recepcao', () => {
    const action = ACTION_BY_KEY.get('tiss.paciente_convenio.write');
    expect(action).toBeDefined();
    expect(action!.roles).toContain('admin_clinico');
    expect(action!.roles).toContain('recepcao');
  });

  it('nenhuma acao TISS exige MFA', () => {
    const tissActions = ACTIONS.filter((a) => a.key.startsWith('tiss.'));
    for (const action of tissActions) {
      expect(action.requiresMfa, `${action.key} nao deve exigir MFA`).toBeUndefined();
    }
  });
});
```

- [ ] Rodar o teste e confirmar que falha porque as acoes ainda nao existem:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm --filter @cadencia/authz exec vitest run src/actions-fase4.test.ts 2>&1 | head -30
```

Saida esperada: os testes falham com "expected undefined not to be undefined" ou similar.

- [ ] Adicionar as acoes TISS em `packages/authz/src/actions.ts`, antes do `] as const satisfies readonly ActionDef[];`:

```typescript
  // ── Fase 4 · Convenios (TISS) ──────────────────────────────────────────
  { key: 'tiss.operadora.read', description: 'Listar operadoras de convenio',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro', 'recepcao'] },
  { key: 'tiss.operadora.write', description: 'Criar ou editar operadora de convenio',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'tiss.contrato.read', description: 'Listar contratos com operadoras',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro'] },
  { key: 'tiss.contrato.write', description: 'Criar ou editar contrato com operadora',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'tiss.paciente_convenio.read', description: 'Listar convenios do paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'tiss.paciente_convenio.write', description: 'Vincular paciente a convenio',
    roles: ['admin_clinico', 'recepcao'] },
```

- [ ] Rodar o teste e confirmar que todos passam:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm --filter @cadencia/authz exec vitest run src/actions-fase4.test.ts
```

Saida esperada: todos os testes de acoes TISS passam.

- [ ] Rodar todos os testes de authz para confirmar que nada quebrou:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm --filter @cadencia/authz exec vitest run
```

Saida esperada: todos os testes passam.

- [ ] Commitar:

```
feat(authz): add Fase 4 TISS RBAC actions for operadora, contrato and paciente_convenio
```