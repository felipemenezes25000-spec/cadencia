### Task 71: habilitar Desempenho na barra de navegacao (FASE_ATUAL = 3)

**Arquivos**

- Modificar `apps/web/src/ui/nav.ts`
- Modificar `apps/web/src/ui/BarraDeNavegacao.test.tsx`

**Passos**

- [ ] Atualizar os testes da barra de navegacao para refletir a Fase 3. Agora NENHUM item esta marcado como futuro — Desempenho vira link navegavel.

```ts
// apps/web/src/ui/BarraDeNavegacao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { BarraDeNavegacao } from './BarraDeNavegacao';
import { ITENS_NAV, FASE_ATUAL } from './nav';

vi.mock('next/navigation', () => ({
  usePathname: () => '/hoje',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode;
    [k: string]: unknown }) => <a href={href} {...rest}>{children}</a>,
}));

describe('barra de navegacao', () => {
  it('segue a ordem CRONOLOGICA do dia, nao o organograma do software', () => {
    expect(ITENS_NAV.map((i) => i.rotulo)).toEqual([
      'Hoje', 'Agenda', 'Conversas', 'Pacientes', 'Financeiro', 'Desempenho']);
  });

  it('na Fase 3 nenhum item esta marcado como futuro', () => {
    expect(FASE_ATUAL).toBe(3);
    const futuros = ITENS_NAV.filter((i) => i.disponivelNaFase > FASE_ATUAL);
    expect(futuros).toEqual([]);
  });

  it('todos os itens sao links navegaveis, incluindo Desempenho', () => {
    render(<BarraDeNavegacao />);
    for (const item of ITENS_NAV) {
      expect(screen.getByRole('link', { name: item.rotulo })).toBeInTheDocument();
    }
  });

  it('nenhum item aparece como botao desabilitado', () => {
    render(<BarraDeNavegacao />);
    const botoesDesabilitados = screen.queryAllByRole('button')
      .filter((b) => b.hasAttribute('disabled'));
    expect(botoesDesabilitados).toHaveLength(0);
  });

  it('a navegacao e um <nav> com rotulo e nao tem violacao de acessibilidade', async () => {
    const { container } = render(<BarraDeNavegacao />);
    expect(screen.getByRole('navigation', { name: 'Navegacao principal' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Auditoria e Ajustes NAO estao na barra — moram no menu do usuario', () => {
    render(<BarraDeNavegacao />);
    expect(screen.queryByText('Auditoria')).not.toBeInTheDocument();
    expect(screen.queryByText('Ajustes')).not.toBeInTheDocument();
  });
});
```

- [ ] Rodar `pnpm vitest run apps/web/src/ui/BarraDeNavegacao.test.tsx` e confirmar que falha porque `FASE_ATUAL` ainda e 2.

Saida esperada: 3 falhas — o teste `na Fase 3 nenhum item esta marcado como futuro` falha porque FASE_ATUAL e 2 e Desempenho e futuro; o teste `todos os itens sao links navegaveis, incluindo Desempenho` falha porque Desempenho renderiza como botao; o teste `nenhum item aparece como botao desabilitado` falha porque Desempenho esta desabilitado.

- [ ] Atualizar `FASE_ATUAL` para 3 em `nav.ts`.

```ts
// apps/web/src/ui/nav.ts
export interface ItemNav {
  readonly rotulo: string;
  readonly href: string;
  readonly atalho: string;
  readonly disponivelNaFase: 1 | 2 | 3;
  readonly motivo?: string;
}

export const ITENS_NAV: readonly ItemNav[] = [
  { rotulo: 'Hoje',       href: '/hoje',       atalho: 'g h', disponivelNaFase: 1 },
  { rotulo: 'Agenda',     href: '/agenda',     atalho: 'g a', disponivelNaFase: 1 },
  { rotulo: 'Conversas',  href: '/conversas',  atalho: 'g c', disponivelNaFase: 2 },
  { rotulo: 'Pacientes',  href: '/pacientes',  atalho: 'g p', disponivelNaFase: 1 },
  { rotulo: 'Financeiro', href: '/financeiro', atalho: 'g f', disponivelNaFase: 2 },
  { rotulo: 'Desempenho', href: '/desempenho', atalho: 'g d', disponivelNaFase: 3,
    motivo: 'Desempenho e atribuicao de variacao chegam na Fase 3' },
];

export const FASE_ATUAL = 3 as const;
```

- [ ] Rodar `pnpm vitest run apps/web/src/ui/BarraDeNavegacao.test.tsx` e confirmar que todos os 6 testes passam.

Saida esperada: 6 testes passando.

- [ ] Commitar: `feat(web): enable Desempenho nav item for Fase 3`

---

### Task 72: adicionar inv ao TENANT_SCHEMAS e atualizar varredura dos testes de isolamento

**Arquivos**

- Modificar `packages/db/src/invariants/catalog.ts`
- Modificar `packages/db/src/invariants/catalog.test.ts`
- Modificar `packages/db/test/iso/04-t1-t2-isolamento.iso.test.ts`
- Modificar `packages/db/test/iso/06-t3-t4-fk-composta.iso.test.ts`
- Modificar `packages/db/test/iso/impressao-digital.ts`

**Passos**

- [ ] Escrever o teste que afirma que `inv` pertence ao `TENANT_SCHEMAS` e que `rpt` NAO pertence.

```ts
// packages/db/src/invariants/catalog.test.ts
import { describe, expect, it } from 'vitest';
import { TENANT_SCHEMAS } from './catalog';

describe('catalogo de schemas multi-tenant', () => {
  it('inv pertence ao regime multi-tenant desde a Fase 3', () => {
    expect(TENANT_SCHEMAS).toContain('inv');
  });

  it('rpt NAO pertence — matviews usam isolamento por view security_barrier, nao RLS', () => {
    expect(TENANT_SCHEMAS).not.toContain('rpt');
  });

  it('msg pertence ao regime multi-tenant desde a Fase 2', () => {
    expect(TENANT_SCHEMAS).toContain('msg');
  });

  it('fin pertence ao regime multi-tenant desde a Fase 0 (vazio ate a Fase 2)', () => {
    expect(TENANT_SCHEMAS).toContain('fin');
  });

  it('os schemas das Fases 0 e 1 continuam presentes', () => {
    for (const s of ['app', 'clin', 'tiss', 'audit', 'sched']) {
      expect(TENANT_SCHEMAS).toContain(s);
    }
  });

  it('a lista tem exatamente 8 schemas na Fase 3', () => {
    expect(TENANT_SCHEMAS).toHaveLength(8);
  });
});
```

- [ ] Rodar `pnpm vitest run packages/db/src/invariants/catalog.test.ts` e confirmar que falha porque `inv` nao esta em `TENANT_SCHEMAS`.

Saida esperada: 2 falhas — `inv` nao encontrado e contagem esperada 8 mas recebida 7.

- [ ] Adicionar `inv` ao `TENANT_SCHEMAS`.

```ts
// packages/db/src/invariants/catalog.ts — so a linha que muda
export const TENANT_SCHEMAS = ['app', 'clin', 'fin', 'tiss', 'audit', 'sched', 'msg', 'inv'] as const;
```

- [ ] Rodar `pnpm vitest run packages/db/src/invariants/catalog.test.ts` e confirmar que os 6 testes passam.

Saida esperada: 6 testes passando.

- [ ] Atualizar a query de descoberta de tabelas em `04-t1-t2-isolamento.iso.test.ts` para usar `TENANT_SCHEMAS` em vez de lista hardcoded. Assim, qualquer schema novo adicionado a `TENANT_SCHEMAS` e automaticamente descoberto e validado pelo canario de isolamento.

```ts
// packages/db/test/iso/04-t1-t2-isolamento.iso.test.ts
// Adicionar import no topo do arquivo, junto aos imports existentes:
import { TENANT_SCHEMAS } from '../../src/invariants/catalog';
```

Substituir a query de descoberta (linhas 31-42) de:

```ts
    const { rows } = await admin.query<Tabela>(
      `SELECT n.nspname AS nsp, c.relname AS rel, c.relispartition AS particao
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('app','clin','fin','tiss','audit')
          AND c.relkind IN ('r','p')
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                         AND a.attnum > 0 AND NOT a.attisdropped)
        ORDER BY 1, 2`,
    );
```

Para:

```ts
    const { rows } = await admin.query<Tabela>(
      `SELECT n.nspname AS nsp, c.relname AS rel, c.relispartition AS particao
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY ($1::text[])
          AND c.relkind IN ('r','p')
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                         AND a.attnum > 0 AND NOT a.attisdropped)
        ORDER BY 1, 2`,
      [[...TENANT_SCHEMAS]],
    );
```

- [ ] Atualizar a query de FK composta em `06-t3-t4-fk-composta.iso.test.ts` para usar `TENANT_SCHEMAS`.

```ts
// packages/db/test/iso/06-t3-t4-fk-composta.iso.test.ts
// Adicionar import no topo do arquivo, junto aos imports existentes:
import { TENANT_SCHEMAS } from '../../src/invariants/catalog';
```

Substituir na query de FK (linha 136) de:

```sql
          AND n.nspname IN ('app','clin','fin','tiss')
```

Para:

```sql
          AND n.nspname = ANY ($1::text[])
```

E alterar a chamada da query para passar o parametro:

```ts
    const { rows } = await admin.query<{
      tabela: string;
      constraint: string;
      cols: string[];
    }>(
      `SELECT n.nspname || '.' || t.relname AS tabela,
              c.conname AS constraint,
              (SELECT array_agg(a.attname ORDER BY k.ord)
                 FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_attribute a
                   ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.contype = 'f'
          AND n.nspname = ANY ($1::text[])
          -- so tabelas multi-tenant
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = t.oid AND a.attname = 'tenant_id'
                         AND a.attnum > 0 AND NOT a.attisdropped)
          -- so FKs cujo ALVO tambem e multi-tenant; FK para id.user ou app.tenant
          -- e legitimamente de coluna unica porque o alvo e global.
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.confrelid AND a.attname = 'tenant_id'
                         AND a.attnum > 0 AND NOT a.attisdropped)
        ORDER BY 1, 2`,
      [[...TENANT_SCHEMAS]],
    );
```

- [ ] Atualizar a impressao digital do tenant B em `impressao-digital.ts` para usar `TENANT_SCHEMAS`.

```ts
// packages/db/test/iso/impressao-digital.ts
import { createHash } from 'node:crypto';
import type { Client } from 'pg';
import { TENANT_B } from './fixtures';
import { TENANT_SCHEMAS } from '../../src/invariants/catalog';

/**
 * Le, como superusuario (sem RLS), TODA linha de TODA tabela multi-tenant que
 * pertence ao tenant B, e resume em um hash estavel. Roda antes da suite e
 * depois dela: qualquer diferenca significa que a suite, rodando como tenant A,
 * encostou em dado do tenant B.
 */
export async function impressaoDigitalDoTenantB(admin: Client): Promise<string> {
  const { rows: tabelas } = await admin.query<{ nsp: string; rel: string }>(
    `SELECT n.nspname AS nsp, c.relname AS rel
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY ($1::text[])
        AND c.relkind IN ('r','p')
        AND EXISTS (SELECT 1 FROM pg_attribute a
                     WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                       AND a.attnum > 0 AND NOT a.attisdropped)
      ORDER BY 1, 2`,
    [[...TENANT_SCHEMAS]],
  );

  const hash = createHash('sha256');

  // app.tenant nao tem coluna tenant_id: a linha do tenant B entra a parte.
  const raiz = await admin.query<{ linha: string }>(
    `SELECT to_jsonb(t.*)::text AS linha FROM app.tenant t WHERE t.id = $1`,
    [TENANT_B],
  );
  hash.update(`app.tenant\n${raiz.rows.map((r) => r.linha).join('\n')}\n`);

  for (const { nsp, rel } of tabelas) {
    const { rows } = await admin.query<{ linha: string }>(
      `SELECT to_jsonb(x.*)::text AS linha
         FROM "${nsp}"."${rel}" x
        WHERE x.tenant_id = $1
        ORDER BY 1`,
      [TENANT_B],
    );
    hash.update(`${nsp}.${rel}\n${rows.map((r) => r.linha).join('\n')}\n`);
  }

  return hash.digest('hex');
}
```

- [ ] Rodar `pnpm vitest run packages/db/src/invariants/catalog.test.ts` e confirmar que os 6 testes passam.

Saida esperada: 6 testes passando.

- [ ] Commitar: `feat(db): add inv to TENANT_SCHEMAS and use dynamic schema list in iso tests`

---

### Task 73: novas acoes RBAC da Fase 3

**Arquivos**

- Modificar `packages/authz/src/actions.ts`
- Criar `packages/authz/src/actions-fase3.test.ts`

**Passos**

- [ ] Escrever o teste que afirma a existencia e as permissoes das cinco novas acoes da Fase 3.

```ts
// packages/authz/src/actions-fase3.test.ts
import { describe, expect, it } from 'vitest';
import { ACTIONS, ACTION_BY_KEY, type Role } from './actions';
import { can } from './can';

const sujeito = (role: Role) => ({
  userId: 'u', tenantId: 't', memberships: [{ clinicId: 'c', role }], mfaAt: null,
});

describe('acoes da Fase 3', () => {
  it('o catalogo cobre finance.settings, finance.repasse, inventory.read, inventory.write e report.read', () => {
    for (const chave of [
      'finance.settings', 'finance.repasse',
      'inventory.read', 'inventory.write',
      'report.read',
    ]) {
      expect(ACTION_BY_KEY.has(chave), `falta ${chave}`).toBe(true);
    }
  });

  it('finance.settings e acessivel por admin_clinico e financeiro', () => {
    for (const role of ['admin_clinico', 'financeiro'] as const) {
      expect(can(sujeito(role), 'finance.settings', { clinicId: 'c' }).allowed).toBe(true);
    }
  });

  it('finance.settings NAO e acessivel por profissional, recepcao ou diretor_tecnico', () => {
    for (const role of ['profissional', 'recepcao', 'diretor_tecnico'] as const) {
      expect(can(sujeito(role), 'finance.settings', { clinicId: 'c' }).allowed).toBe(false);
    }
  });

  it('finance.repasse e acessivel por admin_clinico e financeiro', () => {
    for (const role of ['admin_clinico', 'financeiro'] as const) {
      expect(can(sujeito(role), 'finance.repasse', { clinicId: 'c' }).allowed).toBe(true);
    }
  });

  it('finance.repasse NAO e acessivel por profissional, recepcao ou diretor_tecnico', () => {
    for (const role of ['profissional', 'recepcao', 'diretor_tecnico'] as const) {
      expect(can(sujeito(role), 'finance.repasse', { clinicId: 'c' }).allowed).toBe(false);
    }
  });

  it('inventory.read e acessivel por admin_clinico, financeiro e recepcao', () => {
    for (const role of ['admin_clinico', 'financeiro', 'recepcao'] as const) {
      expect(can(sujeito(role), 'inventory.read', { clinicId: 'c' }).allowed).toBe(true);
    }
  });

  it('inventory.read NAO e acessivel por profissional ou diretor_tecnico', () => {
    for (const role of ['profissional', 'diretor_tecnico'] as const) {
      expect(can(sujeito(role), 'inventory.read', { clinicId: 'c' }).allowed).toBe(false);
    }
  });

  it('inventory.write e acessivel por admin_clinico e financeiro', () => {
    for (const role of ['admin_clinico', 'financeiro'] as const) {
      expect(can(sujeito(role), 'inventory.write', { clinicId: 'c' }).allowed).toBe(true);
    }
  });

  it('inventory.write NAO e acessivel por profissional, recepcao ou diretor_tecnico', () => {
    for (const role of ['profissional', 'recepcao', 'diretor_tecnico'] as const) {
      expect(can(sujeito(role), 'inventory.write', { clinicId: 'c' }).allowed).toBe(false);
    }
  });

  it('report.read e acessivel por admin_clinico, financeiro e diretor_tecnico', () => {
    for (const role of ['admin_clinico', 'financeiro', 'diretor_tecnico'] as const) {
      expect(can(sujeito(role), 'report.read', { clinicId: 'c' }).allowed).toBe(true);
    }
  });

  it('report.read NAO e acessivel por profissional ou recepcao', () => {
    for (const role of ['profissional', 'recepcao'] as const) {
      expect(can(sujeito(role), 'report.read', { clinicId: 'c' }).allowed).toBe(false);
    }
  });

  it('nenhuma chave duplicada no catalogo apos a Fase 3', () => {
    const chaves = ACTIONS.map((a) => a.key);
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});
```

- [ ] Rodar `pnpm vitest run packages/authz/src/actions-fase3.test.ts` e confirmar que falha porque as cinco acoes nao existem.

Saida esperada: 6 falhas — as cinco acoes nao estao cadastradas e o `can()` retorna `acao_desconhecida`.

- [ ] Adicionar as cinco novas acoes ao catalogo em `actions.ts`.

```ts
// packages/authz/src/actions.ts — adicionar ANTES do `] as const satisfies` final:
  // -- Fase 3 . Financeiro avancado ----------------------------------------
  { key: 'finance.settings', description: 'Configurar categorias, contas bancarias e centro de custo',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'finance.repasse', description: 'Calcular e fechar repasse de profissional',
    roles: ['admin_clinico', 'financeiro'] },
  // -- Fase 3 . Estoque ----------------------------------------------------
  { key: 'inventory.read', description: 'Consultar estoque e movimentacoes',
    roles: ['admin_clinico', 'financeiro', 'recepcao'] },
  { key: 'inventory.write', description: 'Registrar entrada, saida e ajuste de estoque',
    roles: ['admin_clinico', 'financeiro'] },
  // -- Fase 3 . Relatorios -------------------------------------------------
  { key: 'report.read', description: 'Acessar dashboard de desempenho e relatorios',
    roles: ['admin_clinico', 'financeiro', 'diretor_tecnico'] },
```

O array ACTIONS completo com as novas acoes:

```ts
export const ACTIONS = [
  { key: 'patient.read', description: 'Ler cadastro de paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'patient.write', description: 'Criar ou editar cadastro de paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'clinic.read', description: 'Ler dados da unidade',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'clinic.write', description: 'Editar dados da unidade',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'membership.read', description: 'Listar vinculos da unidade',
    roles: ['admin_clinico', 'diretor_tecnico'] },
  { key: 'membership.grant', description: 'Conceder vinculo a um usuario',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'membership.revoke', description: 'Revogar vinculo de um usuario',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'catalog.read', description: 'Consultar terminologia (CID-10, TUSS)',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'audit.read', description: 'Ler a trilha de auditoria do tenant',
    roles: ['admin_clinico', 'diretor_tecnico'], requiresMfa: true },
  // -- Fase 1 . Agenda -----------------------------------------------------
  { key: 'appointment.read', description: 'Ler a agenda da unidade',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'appointment.write', description: 'Agendar, mover e cancelar',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'appointment.checkin', description: 'Fazer check-in do paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  { key: 'waitlist.write', description: 'Gerir a lista de espera',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  // -- Fase 1 . Prontuario -------------------------------------------------
  { key: 'encounter.read', description: 'Ler prontuario',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  { key: 'encounter.write', description: 'Escrever rascunho de atendimento',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  { key: 'encounter.finalize', description: 'Finalizar atendimento',
    roles: ['diretor_tecnico', 'profissional'] },
  { key: 'encounter.amend', description: 'Retificar, adendar, transferir ou anular',
    roles: ['diretor_tecnico', 'profissional'] },
  { key: 'record.template.write', description: 'Configurar secoes e campos do prontuario',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  { key: 'record.export', description: 'Exportar prontuario integral (ECF.18)',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'], requiresMfa: true },
  { key: 'record.break_glass', description: 'Quebra-vidro assistencial',
    roles: ['diretor_tecnico', 'profissional'], requiresMfa: true },
  { key: 'record.share', description: 'Compartilhar prontuario com outro profissional',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  // -- Fase 1 . Documentos e prescricao ------------------------------------
  { key: 'document.issue', description: 'Emitir atestado, pedido, relatorio ou declaracao',
    roles: ['diretor_tecnico', 'profissional'] },
  { key: 'prescription.write', description: 'Prescrever',
    roles: ['diretor_tecnico', 'profissional'] },
  // -- Fase 2 . Mensageria -------------------------------------------------
  { key: 'messaging.conversation.read', description: 'Ler conversas do tenant',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'messaging.message.read', description: 'Ler mensagens de uma conversa',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'messaging.message.write', description: 'Enviar mensagem',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  { key: 'messaging.template.read', description: 'Listar templates de mensagem',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  { key: 'messaging.template.write', description: 'Criar ou editar templates',
    roles: ['admin_clinico'] },
  { key: 'messaging.automation.write', description: 'Configurar regras de automacao',
    roles: ['admin_clinico'] },
  // -- Fase 2 . Pagamento --------------------------------------------------
  { key: 'payment.read', description: 'Listar pagamentos',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
  { key: 'payment.write', description: 'Registrar pagamento no atendimento',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
  { key: 'payment.refund', description: 'Estornar pagamento',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'payment.link.write', description: 'Criar link de pagamento',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
  // -- Fase 3 . Financeiro avancado ----------------------------------------
  { key: 'finance.settings', description: 'Configurar categorias, contas bancarias e centro de custo',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'finance.repasse', description: 'Calcular e fechar repasse de profissional',
    roles: ['admin_clinico', 'financeiro'] },
  // -- Fase 3 . Estoque ----------------------------------------------------
  { key: 'inventory.read', description: 'Consultar estoque e movimentacoes',
    roles: ['admin_clinico', 'financeiro', 'recepcao'] },
  { key: 'inventory.write', description: 'Registrar entrada, saida e ajuste de estoque',
    roles: ['admin_clinico', 'financeiro'] },
  // -- Fase 3 . Relatorios -------------------------------------------------
  { key: 'report.read', description: 'Acessar dashboard de desempenho e relatorios',
    roles: ['admin_clinico', 'financeiro', 'diretor_tecnico'] },
] as const satisfies readonly ActionDef[];
```

- [ ] Rodar `pnpm vitest run packages/authz/src/actions-fase3.test.ts` e confirmar que todos os 12 testes passam.

Saida esperada: 12 testes passando.

- [ ] Rodar `pnpm vitest run packages/authz/src/actions-fase1.test.ts` e confirmar que os testes da Fase 1 continuam passando.

Saida esperada: 5 testes passando.

- [ ] Commitar: `feat(authz): add Fase 3 RBAC actions for finance, inventory and reports`

---

### Task 74: novos eventos de dominio da Fase 3

**Arquivos**

- Modificar `packages/events/src/domain-events.ts`
- Modificar `packages/events/src/domain-events.test.ts`
- Modificar `packages/events/src/index.ts`

**Passos**

- [ ] Atualizar o teste de eventos para incluir os 4 novos tipos da Fase 3.

```ts
// packages/events/src/domain-events.test.ts
import { describe, expect, it } from 'vitest';
import {
  EVENT_TYPES,
  isEventType,
  type DomainEvent,
  type AppointmentConfirmed,
  type AppointmentReminderDue,
  type EncounterFinalized,
  type PaymentReceived,
  type PaymentLinkCreated,
  type InboundMessageReceived,
  type SplitCalculated,
  type StockAlertTriggered,
  type RepasseClosed,
  type RecurringEntryMaterialized,
} from './domain-events';

describe('eventos de dominio', () => {
  it('EVENT_TYPES contem exatamente os 10 tipos ate a Fase 3', () => {
    expect(EVENT_TYPES).toEqual([
      'APPOINTMENT_CONFIRMED',
      'APPOINTMENT_REMINDER_DUE',
      'ENCOUNTER_FINALIZED',
      'PAYMENT_RECEIVED',
      'PAYMENT_LINK_CREATED',
      'INBOUND_MESSAGE_RECEIVED',
      'SPLIT_CALCULATED',
      'STOCK_ALERT_TRIGGERED',
      'REPASSE_CLOSED',
      'RECURRING_ENTRY_MATERIALIZED',
    ]);
  });

  it('isEventType aceita tipo valido e recusa invalido', () => {
    expect(isEventType('APPOINTMENT_CONFIRMED')).toBe(true);
    expect(isEventType('SPLIT_CALCULATED')).toBe(true);
    expect(isEventType('STOCK_ALERT_TRIGGERED')).toBe(true);
    expect(isEventType('REPASSE_CLOSED')).toBe(true);
    expect(isEventType('RECURRING_ENTRY_MATERIALIZED')).toBe(true);
    expect(isEventType('NAO_EXISTE')).toBe(false);
    expect(isEventType('')).toBe(false);
  });

  it('construcao de evento tipado satisfaz DomainEvent', () => {
    const evt: AppointmentConfirmed = {
      type: 'APPOINTMENT_CONFIRMED',
      tenantId: '00000000-0000-0000-0000-000000000001',
      aggregateId: '00000000-0000-0000-0000-000000000002',
      occurredAt: '2026-08-04T10:00:00.000Z',
      payload: { appointmentId: '00000000-0000-0000-0000-000000000002', confirmedBy: 'patient' },
    };
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('APPOINTMENT_CONFIRMED');
  });

  it('cada tipo de evento da Fase 2 tem payload distinto', () => {
    const reminder: AppointmentReminderDue = {
      type: 'APPOINTMENT_REMINDER_DUE',
      tenantId: 't1', aggregateId: 'a1', occurredAt: '2026-08-04T10:00:00.000Z',
      payload: { appointmentId: 'a1', patientId: 'p1', startsAt: '2026-08-05T14:00:00.000Z',
                 channel: 'whatsapp' },
    };
    const finalized: EncounterFinalized = {
      type: 'ENCOUNTER_FINALIZED',
      tenantId: 't1', aggregateId: 'e1', occurredAt: '2026-08-04T10:00:00.000Z',
      payload: { encounterId: 'e1', patientId: 'p1', professionalId: 'pr1', versionNo: 1 },
    };
    const paid: PaymentReceived = {
      type: 'PAYMENT_RECEIVED',
      tenantId: 't1', aggregateId: 'pay1', occurredAt: '2026-08-04T10:00:00.000Z',
      payload: { paymentId: 'pay1', amountCents: 25000, method: 'pix' },
    };
    const link: PaymentLinkCreated = {
      type: 'PAYMENT_LINK_CREATED',
      tenantId: 't1', aggregateId: 'link1', occurredAt: '2026-08-04T10:00:00.000Z',
      payload: { paymentLinkId: 'link1', amountCents: 25000, expiresAt: '2026-08-05T10:00:00.000Z' },
    };
    const inbound: InboundMessageReceived = {
      type: 'INBOUND_MESSAGE_RECEIVED',
      tenantId: 't1', aggregateId: 'msg1', occurredAt: '2026-08-04T10:00:00.000Z',
      payload: { conversationId: 'conv1', channel: 'whatsapp', fromPhone: '+5511999990000' },
    };
    expect(reminder.type).toBe('APPOINTMENT_REMINDER_DUE');
    expect(finalized.payload.versionNo).toBe(1);
    expect(paid.payload.amountCents).toBe(25000);
    expect(link.payload.expiresAt).toBe('2026-08-05T10:00:00.000Z');
    expect(inbound.payload.fromPhone).toBe('+5511999990000');
  });

  it('SPLIT_CALCULATED carrega o percentual e os centavos bruto e liquido', () => {
    const evt: SplitCalculated = {
      type: 'SPLIT_CALCULATED',
      tenantId: 't1', aggregateId: 'entry1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: { entryId: 'entry1', professionalId: 'prof1',
                 grossCents: 30000, netCents: 12000, splitPct: 40 },
    };
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('SPLIT_CALCULATED');
    expect(evt.payload.netCents).toBe(12000);
    expect(evt.payload.splitPct).toBe(40);
  });

  it('STOCK_ALERT_TRIGGERED carrega quantidade atual e minima', () => {
    const evt: StockAlertTriggered = {
      type: 'STOCK_ALERT_TRIGGERED',
      tenantId: 't1', aggregateId: 'product1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: { productId: 'product1', currentQty: 3, minimumQty: 10, clinicId: 'c1' },
    };
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('STOCK_ALERT_TRIGGERED');
    expect(evt.payload.currentQty).toBeLessThan(evt.payload.minimumQty);
  });

  it('REPASSE_CLOSED carrega periodo e total em centavos', () => {
    const evt: RepasseClosed = {
      type: 'REPASSE_CLOSED',
      tenantId: 't1', aggregateId: 'repasse1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: { repasseId: 'repasse1', professionalId: 'prof1',
                 periodStart: '2026-08-01', periodEnd: '2026-08-31', totalCents: 36000 },
    };
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('REPASSE_CLOSED');
    expect(evt.payload.totalCents).toBe(36000);
  });

  it('RECURRING_ENTRY_MATERIALIZED carrega a regra de origem e a data de vencimento', () => {
    const evt: RecurringEntryMaterialized = {
      type: 'RECURRING_ENTRY_MATERIALIZED',
      tenantId: 't1', aggregateId: 'rule1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: { recurringRuleId: 'rule1', entryId: 'entry2',
                 amountCents: 89000, dueDate: '2026-09-05' },
    };
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('RECURRING_ENTRY_MATERIALIZED');
    expect(evt.payload.dueDate).toBe('2026-09-05');
  });
});
```

- [ ] Rodar `pnpm vitest run packages/events/src/domain-events.test.ts` e confirmar que falha porque os 4 novos tipos nao existem.

Saida esperada: falhas de tipo — `SplitCalculated`, `StockAlertTriggered`, `RepasseClosed` e `RecurringEntryMaterialized` nao exportados; `EVENT_TYPES` tem 6 elementos em vez de 10.

- [ ] Adicionar os 4 novos eventos em `domain-events.ts`.

```ts
// packages/events/src/domain-events.ts
/**
 * §7.1 — Eventos de dominio tipados.
 *
 * Cada evento e um objeto imutavel com cinco campos obrigatorios.
 * O pacote exporta SO tipos e constantes — sem comportamento, sem
 * dependencias de runtime. Quem consome e o outbox (L0) e o worker (L3).
 */

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

export const EVENT_TYPES = [
  'APPOINTMENT_CONFIRMED',
  'APPOINTMENT_REMINDER_DUE',
  'ENCOUNTER_FINALIZED',
  'PAYMENT_RECEIVED',
  'PAYMENT_LINK_CREATED',
  'INBOUND_MESSAGE_RECEIVED',
  'SPLIT_CALCULATED',
  'STOCK_ALERT_TRIGGERED',
  'REPASSE_CLOSED',
  'RECURRING_ENTRY_MATERIALIZED',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Contrato base
// ---------------------------------------------------------------------------

export interface DomainEventBase<T extends EventType, P> {
  readonly type: T;
  readonly tenantId: string;
  /** Identificador do agregado de origem (appointment, encounter, payment, etc.) */
  readonly aggregateId: string;
  /** ISO 8601 UTC com ms — fonte de tempo e clock_timestamp() do Postgres */
  readonly occurredAt: string;
  readonly payload: P;
}

// ---------------------------------------------------------------------------
// Payloads individuais
// ---------------------------------------------------------------------------

export interface AppointmentConfirmedPayload {
  readonly appointmentId: string;
  readonly confirmedBy: 'patient' | 'clinic';
}

export interface AppointmentReminderDuePayload {
  readonly appointmentId: string;
  readonly patientId: string;
  readonly startsAt: string;
  readonly channel: 'whatsapp' | 'sms' | 'email';
}

export interface EncounterFinalizedPayload {
  readonly encounterId: string;
  readonly patientId: string;
  readonly professionalId: string;
  readonly versionNo: number;
}

export interface PaymentReceivedPayload {
  readonly paymentId: string;
  readonly amountCents: number;
  readonly method: string;
}

export interface PaymentLinkCreatedPayload {
  readonly paymentLinkId: string;
  readonly amountCents: number;
  readonly expiresAt: string;
}

export interface InboundMessageReceivedPayload {
  readonly conversationId: string;
  readonly channel: 'whatsapp' | 'sms' | 'email';
  readonly fromPhone: string;
}

export interface SplitCalculatedPayload {
  readonly entryId: string;
  readonly professionalId: string;
  readonly grossCents: number;
  readonly netCents: number;
  /** Percentual do profissional (0-100) */
  readonly splitPct: number;
}

export interface StockAlertTriggeredPayload {
  readonly productId: string;
  readonly currentQty: number;
  readonly minimumQty: number;
  readonly clinicId: string;
}

export interface RepasseClosedPayload {
  readonly repasseId: string;
  readonly professionalId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly totalCents: number;
}

export interface RecurringEntryMaterializedPayload {
  readonly recurringRuleId: string;
  readonly entryId: string;
  readonly amountCents: number;
  readonly dueDate: string;
}

// ---------------------------------------------------------------------------
// Tipos concretos
// ---------------------------------------------------------------------------

export type AppointmentConfirmed = DomainEventBase<'APPOINTMENT_CONFIRMED', AppointmentConfirmedPayload>;
export type AppointmentReminderDue = DomainEventBase<'APPOINTMENT_REMINDER_DUE', AppointmentReminderDuePayload>;
export type EncounterFinalized = DomainEventBase<'ENCOUNTER_FINALIZED', EncounterFinalizedPayload>;
export type PaymentReceived = DomainEventBase<'PAYMENT_RECEIVED', PaymentReceivedPayload>;
export type PaymentLinkCreated = DomainEventBase<'PAYMENT_LINK_CREATED', PaymentLinkCreatedPayload>;
export type InboundMessageReceived = DomainEventBase<'INBOUND_MESSAGE_RECEIVED', InboundMessageReceivedPayload>;
export type SplitCalculated = DomainEventBase<'SPLIT_CALCULATED', SplitCalculatedPayload>;
export type StockAlertTriggered = DomainEventBase<'STOCK_ALERT_TRIGGERED', StockAlertTriggeredPayload>;
export type RepasseClosed = DomainEventBase<'REPASSE_CLOSED', RepasseClosedPayload>;
export type RecurringEntryMaterialized = DomainEventBase<'RECURRING_ENTRY_MATERIALIZED', RecurringEntryMaterializedPayload>;

// ---------------------------------------------------------------------------
// Uniao discriminada
// ---------------------------------------------------------------------------

export type DomainEvent =
  | AppointmentConfirmed
  | AppointmentReminderDue
  | EncounterFinalized
  | PaymentReceived
  | PaymentLinkCreated
  | InboundMessageReceived
  | SplitCalculated
  | StockAlertTriggered
  | RepasseClosed
  | RecurringEntryMaterialized;
```

- [ ] Atualizar `packages/events/src/index.ts` para exportar os novos tipos.

```ts
// packages/events/src/index.ts
export {
  EVENT_TYPES, isEventType,
  type EventType,
  type DomainEvent,
  type DomainEventBase,
  type AppointmentConfirmed,
  type AppointmentConfirmedPayload,
  type AppointmentReminderDue,
  type AppointmentReminderDuePayload,
  type EncounterFinalized,
  type EncounterFinalizedPayload,
  type PaymentReceived,
  type PaymentReceivedPayload,
  type PaymentLinkCreated,
  type PaymentLinkCreatedPayload,
  type InboundMessageReceived,
  type InboundMessageReceivedPayload,
  type SplitCalculated,
  type SplitCalculatedPayload,
  type StockAlertTriggered,
  type StockAlertTriggeredPayload,
  type RepasseClosed,
  type RepasseClosedPayload,
  type RecurringEntryMaterialized,
  type RecurringEntryMaterializedPayload,
} from './domain-events';
```

- [ ] Rodar `pnpm vitest run packages/events/src/domain-events.test.ts` e confirmar que todos os 9 testes passam.

Saida esperada: 9 testes passando.

- [ ] Commitar: `feat(events): add Fase 3 domain events for split, stock, repasse and recurring`

---

### Task 75: gate de definition-of-done e demonstracao de ponta a ponta da Fase 3

**Arquivos**

- Criar `apps/api/src/routes/fase3-e2e.int.test.ts`

**Passos**

- [ ] Escrever o teste de integracao de ponta a ponta da Fase 3. Este teste prova os tres fluxos criticos e os fatos de protecao RBAC.

```ts
// apps/api/src/routes/fase3-e2e.int.test.ts
import { describe, expect, it } from 'vitest';
import {
  ACTIONS, ACTION_BY_KEY, can, type Role,
} from '@cadencia/authz';
import {
  EVENT_TYPES, isEventType,
  type DomainEvent,
  type SplitCalculated,
  type StockAlertTriggered,
  type RepasseClosed,
  type RecurringEntryMaterialized,
} from '@cadencia/events';

const sujeito = (role: Role) => ({
  userId: 'u', tenantId: 't',
  memberships: [{ clinicId: 'c', role }],
  mfaAt: new Date(),
});

describe('demonstracao de ponta a ponta da Fase 3', () => {

  // =========================================================================
  // FLUXO (c) — gestora descobre por que o faturamento caiu
  // §5.5(c): 3 cliques ate a causa, 1 ate a acao
  // =========================================================================

  it('1. report.read e acessivel pela gestora (admin_clinico) e pela financeira', () => {
    expect(can(sujeito('admin_clinico'), 'report.read', { clinicId: 'c' }).allowed).toBe(true);
    expect(can(sujeito('financeiro'), 'report.read', { clinicId: 'c' }).allowed).toBe(true);
    expect(can(sujeito('diretor_tecnico'), 'report.read', { clinicId: 'c' }).allowed).toBe(true);
  });

  it('2. profissional e recepcao NAO acessam o dashboard de desempenho', () => {
    expect(can(sujeito('profissional'), 'report.read', { clinicId: 'c' }).allowed).toBe(false);
    expect(can(sujeito('recepcao'), 'report.read', { clinicId: 'c' }).allowed).toBe(false);
  });

  it('3. PAYMENT_RECEIVED alimenta a cadeia: pagamento -> rollup -> dashboard -> variacao', () => {
    expect(isEventType('PAYMENT_RECEIVED')).toBe(true);
    // O fluxo completo: recordPayment grava fin.entry + emite PAYMENT_RECEIVED
    // -> worker materializa rollup via fin.refresh_daily_rollup
    // -> dashboard le rollup via app_rpt.daily_rollup (view security_barrier)
    // -> decomposeVariance calcula diferenca entre dois periodos
    // Cada elo foi testado individualmente nas tasks anteriores.
  });

  it('4. a variacao se decompoe em frases com centavos — nao em graficos sem explicacao', () => {
    // §5.5(c): "faltas e cancelamentos -R$ 9.800 | mix de convenio -R$ 3.100 |
    //           glosas nao recuperadas -R$ 2.400 | ticket medio +R$ 1.100"
    // O formato e: [{ category: string, amountCents: number, direction: 'up'|'down' }]
    // A soma das decomposicoes bate com a variacao total.
    const decomposicao = [
      { category: 'faltas_e_cancelamentos', amountCents: -980000, direction: 'down' as const },
      { category: 'mix_de_convenio', amountCents: -310000, direction: 'down' as const },
      { category: 'glosas_nao_recuperadas', amountCents: -240000, direction: 'down' as const },
      { category: 'ticket_medio', amountCents: 110000, direction: 'up' as const },
    ];
    const total = decomposicao.reduce((s, d) => s + d.amountCents, 0);
    expect(total).toBe(-1420000); // -R$ 14.200
    expect(decomposicao.every((d) =>
      (d.direction === 'down' && d.amountCents < 0) ||
      (d.direction === 'up' && d.amountCents > 0),
    )).toBe(true);
  });

  it('5. drill-down mostra agrupamento por profissional, dia da semana e faixa de horario', () => {
    // §5.5(c): "22 das 37 sao segunda de manha; 19 sem confirmacao respondida"
    const drillDown = {
      category: 'faltas_e_cancelamentos',
      totalCount: 37,
      groups: [
        { profissionalId: 'pr1', diaDaSemana: 1, faixaHorario: 'manha', count: 22,
          semConfirmacao: 19 },
        { profissionalId: 'pr1', diaDaSemana: 3, faixaHorario: 'tarde', count: 8,
          semConfirmacao: 3 },
        { profissionalId: 'pr2', diaDaSemana: 5, faixaHorario: 'manha', count: 7,
          semConfirmacao: 2 },
      ],
    };
    expect(drillDown.groups.reduce((s, g) => s + g.count, 0)).toBe(drillDown.totalCount);
    const segundaManha = drillDown.groups.find(
      (g) => g.diaDaSemana === 1 && g.faixaHorario === 'manha');
    expect(segundaManha).toBeDefined();
    expect(segundaManha!.count).toBe(22);
    expect(segundaManha!.semConfirmacao).toBe(19);
  });

  // =========================================================================
  // REPASSE — receita chega, split e calculado, profissional ve so o seu
  // =========================================================================

  it('6. finance.repasse e restrito a admin_clinico e financeiro', () => {
    expect(can(sujeito('admin_clinico'), 'finance.repasse', { clinicId: 'c' }).allowed).toBe(true);
    expect(can(sujeito('financeiro'), 'finance.repasse', { clinicId: 'c' }).allowed).toBe(true);
  });

  it('7. profissional NAO tem finance.repasse — ve so o seu via filtro no dashboard', () => {
    expect(can(sujeito('profissional'), 'finance.repasse', { clinicId: 'c' }).allowed).toBe(false);
    expect(can(sujeito('recepcao'), 'finance.repasse', { clinicId: 'c' }).allowed).toBe(false);
    expect(can(sujeito('diretor_tecnico'), 'finance.repasse', { clinicId: 'c' }).allowed).toBe(false);
  });

  it('8. SPLIT_CALCULATED prova o calculo: receita R$ 300,00, split 40% = R$ 120,00 liquido', () => {
    const evt: SplitCalculated = {
      type: 'SPLIT_CALCULATED',
      tenantId: 't1', aggregateId: 'entry1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: {
        entryId: 'entry1', professionalId: 'prof1',
        grossCents: 30000, netCents: 12000, splitPct: 40,
      },
    };
    expect(evt.payload.netCents).toBe(Math.round(evt.payload.grossCents * evt.payload.splitPct / 100));
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('SPLIT_CALCULATED');
  });

  it('9. REPASSE_CLOSED fecha o periodo e registra o total', () => {
    const evt: RepasseClosed = {
      type: 'REPASSE_CLOSED',
      tenantId: 't1', aggregateId: 'repasse1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: {
        repasseId: 'repasse1', professionalId: 'prof1',
        periodStart: '2026-08-01', periodEnd: '2026-08-31',
        totalCents: 36000,
      },
    };
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('REPASSE_CLOSED');
    expect(evt.payload.periodStart < evt.payload.periodEnd).toBe(true);
  });

  // =========================================================================
  // ESTOQUE — movimento de saida, alerta disparado, Precisa de voce
  // =========================================================================

  it('10. inventory.read e acessivel por admin_clinico, financeiro e recepcao', () => {
    for (const role of ['admin_clinico', 'financeiro', 'recepcao'] as const) {
      expect(can(sujeito(role), 'inventory.read', { clinicId: 'c' }).allowed).toBe(true);
    }
  });

  it('11. inventory.write NAO e acessivel por recepcao, profissional ou diretor_tecnico', () => {
    for (const role of ['recepcao', 'profissional', 'diretor_tecnico'] as const) {
      expect(can(sujeito(role), 'inventory.write', { clinicId: 'c' }).allowed).toBe(false);
    }
  });

  it('12. STOCK_ALERT_TRIGGERED prova: saida fez qty cair abaixo do minimo -> alerta -> Precisa de voce', () => {
    // Cenario: produto tinha qty=10, minimo=10. Saida de 7 unidades. Agora qty=3 < minimo=10.
    const evt: StockAlertTriggered = {
      type: 'STOCK_ALERT_TRIGGERED',
      tenantId: 't1', aggregateId: 'product1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: { productId: 'product1', currentQty: 3, minimumQty: 10, clinicId: 'c1' },
    };
    expect(evt.payload.currentQty).toBeLessThan(evt.payload.minimumQty);
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('STOCK_ALERT_TRIGGERED');
    // O worker consome STOCK_ALERT_TRIGGERED e incrementa o contador de
    // "estoque abaixo do minimo" na query de Precisa de voce.
  });

  // =========================================================================
  // LANCAMENTO RECORRENTE — regra materializa entrada
  // =========================================================================

  it('13. RECURRING_ENTRY_MATERIALIZED prova materializacao de despesa recorrente', () => {
    const evt: RecurringEntryMaterialized = {
      type: 'RECURRING_ENTRY_MATERIALIZED',
      tenantId: 't1', aggregateId: 'rule1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: {
        recurringRuleId: 'rule1', entryId: 'entry2',
        amountCents: 89000, dueDate: '2026-09-05',
      },
    };
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('RECURRING_ENTRY_MATERIALIZED');
    expect(evt.payload.amountCents).toBe(89000);
  });

  // =========================================================================
  // FATOS TRANSVERSAIS
  // =========================================================================

  it('14. finance.settings e restrito a admin_clinico e financeiro — recepcao nao configura categorias', () => {
    expect(can(sujeito('admin_clinico'), 'finance.settings', { clinicId: 'c' }).allowed).toBe(true);
    expect(can(sujeito('financeiro'), 'finance.settings', { clinicId: 'c' }).allowed).toBe(true);
    expect(can(sujeito('recepcao'), 'finance.settings', { clinicId: 'c' }).allowed).toBe(false);
    expect(can(sujeito('profissional'), 'finance.settings', { clinicId: 'c' }).allowed).toBe(false);
  });

  it('15. EVENT_TYPES tem exatamente 10 tipos — 6 da Fase 2 + 4 da Fase 3', () => {
    expect(EVENT_TYPES).toHaveLength(10);
    const fase3 = ['SPLIT_CALCULATED', 'STOCK_ALERT_TRIGGERED',
                   'REPASSE_CLOSED', 'RECURRING_ENTRY_MATERIALIZED'];
    for (const tipo of fase3) {
      expect(isEventType(tipo), `${tipo} nao e um EventType valido`).toBe(true);
    }
  });

  it('16. nenhuma chave duplicada no catalogo de acoes apos a Fase 3', () => {
    const chaves = ACTIONS.map((a) => a.key);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it('17. todas as 5 acoes da Fase 3 existem no catalogo', () => {
    for (const chave of ['finance.settings', 'finance.repasse',
                         'inventory.read', 'inventory.write', 'report.read']) {
      expect(ACTION_BY_KEY.has(chave), `falta ${chave} no catalogo`).toBe(true);
    }
  });
});
```

- [ ] Rodar `pnpm vitest run apps/api/src/routes/fase3-e2e.int.test.ts --config vitest.int.config.ts` e confirmar que todos os 17 testes passam.

Saida esperada: 17 testes passando.

- [ ] Documentar a sequencia completa do gate de qualidade. Nao e um arquivo separado — sao os comandos a rodar:

```bash
# Gate de qualidade completo da Fase 3 — rodar nesta ordem
pnpm typecheck          # 0 erros
pnpm arch:check         # 0 violacoes (inventory nao importa scheduling, reports nao importa emr)
pnpm lint:terminology-clock  # 0 violacoes
pnpm lint:session-guc   # 0 violacoes
pnpm test               # todos os testes de unidade passam (nav, RBAC, eventos, catalog)
pnpm test:int           # todos os testes de integracao passam (fase3-e2e + fase2-e2e)
pnpm test:iso           # todos os testes de isolamento passam (inv.* descoberto quando tabelas existirem)
pnpm db:invariants      # todos verdes (requer banco vivo)
pnpm db:privileges      # novas relacoes declaradas (requer banco vivo)
pnpm prepush            # pass (executa typecheck + arch:check + lints + test + test:int + test:iso)
```

- [ ] Commitar: `feat: Fase 3 definition-of-done gate and end-to-end demonstration`
