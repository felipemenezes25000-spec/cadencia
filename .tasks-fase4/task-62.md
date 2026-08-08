### Task 62: Acoes RBAC para TISS no catalogo de autorizacao

**Arquivos**
- Modificar: `packages/authz/src/actions.ts`
- Teste: `packages/authz/src/actions-tiss.test.ts`

**Passos**

- [ ] Escrever o teste que valida as novas acoes TISS:

```ts
// packages/authz/src/actions-tiss.test.ts
import { describe, expect, it } from 'vitest';
import { ACTION_BY_KEY, ACTIONS } from './actions';

describe('acoes TISS (Fase 4)', () => {
  const tissKeys = [
    'tiss.operadora.manage',
    'tiss.guia.read',
    'tiss.guia.adjust',
    'tiss.lote.manage',
    'tiss.lote.send',
  ];

  it.each(tissKeys)('acao "%s" existe no catalogo', (key) => {
    expect(ACTION_BY_KEY.has(key)).toBe(true);
  });

  it('tiss.operadora.manage so para admin_clinico', () => {
    const action = ACTION_BY_KEY.get('tiss.operadora.manage')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).not.toContain('profissional');
    expect(action.roles).not.toContain('recepcao');
    expect(action.roles).not.toContain('financeiro');
  });

  it('tiss.guia.read permite admin_clinico, medico e recepcao', () => {
    const action = ACTION_BY_KEY.get('tiss.guia.read')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('profissional');
    expect(action.roles).toContain('recepcao');
  });

  it('tiss.guia.adjust so para admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.guia.adjust')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).not.toContain('profissional');
    expect(action.roles).not.toContain('recepcao');
  });

  it('tiss.lote.manage permite admin_clinico, recepcao e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.lote.manage')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('recepcao');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).not.toContain('profissional');
  });

  it('tiss.lote.send so para admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.lote.send')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).not.toContain('recepcao');
    expect(action.roles).not.toContain('profissional');
  });

  it('nenhuma acao TISS exige MFA', () => {
    for (const key of tissKeys) {
      const action = ACTION_BY_KEY.get(key)!;
      expect(action.requiresMfa).toBeUndefined();
    }
  });

  it('nenhuma chave duplicada no catalogo', () => {
    const keys = ACTIONS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run packages/authz/src/actions-tiss.test.ts
# ESPERADO: FAIL — acao "tiss.operadora.manage" nao existe no catalogo
```

- [ ] Adicionar as 5 acoes ao catalogo. Em `packages/authz/src/actions.ts`, inserir antes do `] as const satisfies readonly ActionDef[];`:

```ts
  // -- Fase 4 . TISS ─────────────────────────────────────────────────────
  // NOTA RECONCILIACAO: tiss.operadora.manage foi desmembrado em .read/.write
  // conforme o Bloco 01. As rotas GET devem usar tiss.operadora.read, as rotas
  // POST/PUT/DELETE devem usar tiss.operadora.write. O catalogo de acoes
  // da operadora esta definido pelo Bloco 01 (veja 00-CONTRATOS.md).
  // Este bloco adiciona apenas as acoes de guia e lote:
  { key: 'tiss.guia.read', description: 'Visualizar guias TISS pendentes e enviadas',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'tiss.guia.adjust', description: 'Ajustar codigo de procedimento na guia para faturamento',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'tiss.lote.manage', description: 'Criar, montar e cancelar lotes TISS',
    roles: ['admin_clinico', 'recepcao', 'financeiro'] },
  { key: 'tiss.lote.send', description: 'Enviar lote TISS para operadora (gera XML)',
    roles: ['admin_clinico', 'financeiro'] },
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run packages/authz/src/actions-tiss.test.ts
# ESPERADO: PASS — todas as 8 assercoes verdes
```

- [ ] Commitar:

```bash
git add packages/authz/src/actions.ts packages/authz/src/actions-tiss.test.ts
git commit -m "feat(authz): add Fase 4 TISS RBAC actions

Add tiss.operadora.manage, tiss.guia.read, tiss.guia.adjust,
tiss.lote.manage and tiss.lote.send to the action catalog.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---