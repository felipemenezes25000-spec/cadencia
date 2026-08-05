### Task 36: registrar acoes de RBAC de mensageria e pagamento no catalogo

**Arquivos**
- Modificar `packages/authz/src/actions.ts`
- Teste `packages/authz/src/actions.test.ts` (Criar)

**Passos**

- [ ] Criar o teste que verifica as novas acoes no catalogo.

```ts
// packages/authz/src/actions.test.ts
import { describe, expect, it } from 'vitest';
import { ACTION_BY_KEY, ACTIONS } from './actions';

describe('catalogo de acoes — mensageria e pagamento', () => {
  const ESPERADAS = [
    'messaging.conversation.read',
    'messaging.message.read',
    'messaging.message.write',
    'messaging.template.read',
    'messaging.template.write',
    'messaging.automation.write',
    'payment.read',
    'payment.write',
    'payment.refund',
    'payment.link.write',
  ];

  it.each(ESPERADAS)('acao %s existe no catalogo', (key) => {
    expect(ACTION_BY_KEY.has(key)).toBe(true);
  });

  it('recepcao pode ver conversas e registrar pagamento', () => {
    const convRead = ACTION_BY_KEY.get('messaging.conversation.read')!;
    const msgRead = ACTION_BY_KEY.get('messaging.message.read')!;
    const payWrite = ACTION_BY_KEY.get('payment.write')!;
    expect(convRead.roles).toContain('recepcao');
    expect(msgRead.roles).toContain('recepcao');
    expect(payWrite.roles).toContain('recepcao');
  });

  it('profissional pode ver conversas mas nao configurar automacoes', () => {
    const convRead = ACTION_BY_KEY.get('messaging.conversation.read')!;
    const autoWrite = ACTION_BY_KEY.get('messaging.automation.write')!;
    expect(convRead.roles).toContain('profissional');
    expect(autoWrite.roles).not.toContain('profissional');
  });

  it('admin pode configurar automacoes e templates', () => {
    const autoWrite = ACTION_BY_KEY.get('messaging.automation.write')!;
    const tplWrite = ACTION_BY_KEY.get('messaging.template.write')!;
    expect(autoWrite.roles).toContain('admin_clinico');
    expect(tplWrite.roles).toContain('admin_clinico');
  });

  it('estorno exige papel financeiro ou admin', () => {
    const refund = ACTION_BY_KEY.get('payment.refund')!;
    expect(refund.roles).toContain('admin_clinico');
    expect(refund.roles).toContain('financeiro');
    expect(refund.roles).not.toContain('recepcao');
  });

  it('nao ha chaves duplicadas no catalogo', () => {
    const chaves = ACTIONS.map((a) => a.key);
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});
```

- [ ] Rodar o teste e confirmar que falha (as acoes ainda nao existem).

```bash
pnpm vitest run packages/authz/src/actions.test.ts
# Esperado: FAIL — ACTION_BY_KEY.has(...) retorna false
```

- [ ] Adicionar as novas acoes ao catalogo em `packages/authz/src/actions.ts`.

```ts
// packages/authz/src/actions.ts
// Substituir o array ACTIONS inteiro. Mantemos tudo que ja existe e acrescentamos
// as novas acoes de mensageria e pagamento ao final.

/**
 * FONTE UNICA do catalogo de acoes. Este arquivo e o unico lugar onde uma acao
 * nasce. O comando `pnpm authz:seed` regenera a tabela ref.action e o arquivo
 * packages/authz/actions.lock.json a partir daqui -- nunca o contrario.
 *
 * O que este catalogo NAO faz: filtrar linha. Isso e do RLS (§3.3). Aqui so se
 * decide o que a ROTA permite, olhando papel no vinculo.
 */
export const ROLES = [
  'admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro',
] as const;
export type Role = (typeof ROLES)[number];

export interface ActionDef {
  readonly key: string;
  readonly description: string;
  readonly roles: readonly Role[];
  readonly requiresMfa?: boolean;
}

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
  // ── Fase 1 · Agenda ──────────────────────────────────────────────────────
  { key: 'appointment.read', description: 'Ler a agenda da unidade',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'appointment.write', description: 'Agendar, mover e cancelar',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'appointment.checkin', description: 'Fazer check-in do paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  { key: 'waitlist.write', description: 'Gerir a lista de espera',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  // ── Fase 1 · Prontuario ──────────────────────────────────────────────────
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
  // ── Fase 1 · Documentos e prescricao ─────────────────────────────────────
  { key: 'document.issue', description: 'Emitir atestado, pedido, relatorio ou declaracao',
    roles: ['diretor_tecnico', 'profissional'] },
  { key: 'prescription.write', description: 'Prescrever',
    roles: ['diretor_tecnico', 'profissional'] },
  // ── Fase 2 · Mensageria ──────────────────────────────────────────────────
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
  // ── Fase 2 · Pagamento ───────────────────────────────────────────────────
  { key: 'payment.read', description: 'Listar pagamentos',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
  { key: 'payment.write', description: 'Registrar pagamento no atendimento',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
  { key: 'payment.refund', description: 'Estornar pagamento',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'payment.link.write', description: 'Criar link de pagamento',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
] as const satisfies readonly ActionDef[];

export type ActionKey = (typeof ACTIONS)[number]['key'];

export const ACTION_BY_KEY: ReadonlyMap<string, ActionDef> =
  new Map(ACTIONS.map((a) => [a.key, a as ActionDef] as const));
```

- [ ] Rodar o teste e confirmar que passa.

```bash
pnpm vitest run packages/authz/src/actions.test.ts
# Esperado: PASS — todas as 6 assertivas verdes
```

- [ ] Commitar.

```bash
git add packages/authz/src/actions.ts packages/authz/src/actions.test.ts
git commit -m "feat(authz): add messaging and payment RBAC actions to catalog"
```

---