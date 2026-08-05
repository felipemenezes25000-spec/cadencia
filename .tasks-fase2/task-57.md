### Task 57: adicionar abas Conversas e Financeiro na ficha do paciente

**Arquivos**

- Modificar `apps/web/src/telas/FichaDoPaciente.tsx`
- Modificar `apps/web/src/telas/FichaDoPaciente.test.tsx`

**Passos**

- [ ] Estender `FichaDoPacienteProps` com callbacks para conversas e financeiro. Adicionar abas condicionais.

```ts
// apps/web/src/telas/FichaDoPaciente.tsx
'use client';

import { useState } from 'react';
import { Botao } from '../ui/Botao';
import type { PacienteHit } from '../ui/ComboboxDePaciente';

export type PapelNaTela = 'profissional' | 'recepcao' | 'financeiro'
                        | 'admin_clinico' | 'diretor_tecnico';

export interface MensagemResumo {
  readonly messageId: string;
  readonly direction: 'inbound' | 'outbound';
  readonly bodyPreview: string;
  readonly sentAt: string;
  readonly status: 'sent' | 'delivered' | 'read' | 'failed';
}

export interface LancamentoResumo {
  readonly entryId: string;
  readonly description: string;
  readonly amountCents: number;
  readonly status: 'pending' | 'paid' | 'overdue' | 'cancelled';
  readonly dueDate: string;
  readonly paidAt: string | null;
}

export interface FichaDoPacienteProps {
  readonly paciente: PacienteHit;
  readonly papel: PapelNaTela;
  readonly pendentes: readonly string[];
  readonly prontuarioAcessivel: boolean;
  readonly existeMasSemAcesso: boolean;
  readonly carregarProntuario: () => Promise<unknown[]>;
  readonly aoSolicitarAcesso: () => void;
  readonly aoQuebrarVidro: (justificativa: string, horas: number) => Promise<void>;
  readonly carregarConversas: () => Promise<MensagemResumo[]>;
  readonly carregarFinanceiro: () => Promise<LancamentoResumo[]>;
  readonly podeVerFinanceiro: boolean;
}

const CLINICOS = new Set<PapelNaTela>(['profissional', 'admin_clinico', 'diretor_tecnico']);
const VE_FINANCEIRO = new Set<PapelNaTela>(['financeiro', 'admin_clinico', 'diretor_tecnico']);

type Aba = 'perfil' | 'atendimentos' | 'prontuario' | 'conversas' | 'financeiro';

export function FichaDoPaciente(p: FichaDoPacienteProps) {
  const veProntuario = CLINICOS.has(p.papel);
  const veFinanceiro = p.podeVerFinanceiro || VE_FINANCEIRO.has(p.papel);
  const [aba, setAba] = useState<Aba>('perfil');
  const [pedindoVidro, setPedindoVidro] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const [conversas, setConversas] = useState<MensagemResumo[] | null>(null);
  const [lancamentos, setLancamentos] = useState<LancamentoResumo[] | null>(null);

  const abas: { chave: Aba; rotulo: string }[] = [
    { chave: 'perfil', rotulo: 'Perfil' },
    { chave: 'atendimentos', rotulo: 'Atendimentos' },
    ...(veProntuario ? [{ chave: 'prontuario' as const, rotulo: 'Prontuário' }] : []),
    { chave: 'conversas', rotulo: 'Conversas' },
    ...(veFinanceiro ? [{ chave: 'financeiro' as const, rotulo: 'Financeiro' }] : []),
  ];

  function selecionarAba(chave: Aba): void {
    setAba(chave);
    if (chave === 'conversas' && conversas === null) {
      void p.carregarConversas().then(setConversas);
    }
    if (chave === 'financeiro' && lancamentos === null) {
      void p.carregarFinanceiro().then(setLancamentos);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)' }}>
      <header style={{ display: 'grid', gap: 'var(--s-2)' }}>
        <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          {p.paciente.displayName}
        </h1>
        {p.pendentes.length > 0 ? (
          <p role="status" style={{
            margin: 0, fontSize: 'var(--fs-13)', color: 'var(--warn)',
            background: 'var(--warn-soft)', padding: `var(--s-3) var(--s-4)`,
            borderRadius: 'var(--r-md)',
          }}>
            {`${p.pendentes.length} dados pendentes`}
            <span style={{ color: 'var(--text-muted)' }}>{` · ${p.pendentes.join(', ')}`}</span>
          </p>
        ) : null}
      </header>

      <div role="tablist" aria-label="Seções do paciente" style={{ display: 'flex',
                                                                   gap: 'var(--s-1)' }}>
        {abas.map((a) => (
          <button key={a.chave} role="tab" type="button" aria-selected={aba === a.chave}
            onClick={() => selecionarAba(a.chave)}
            style={{
              border: 0, borderBottom: aba === a.chave
                ? '2px solid var(--accent)' : '2px solid transparent',
              background: 'transparent', color: aba === a.chave
                ? 'var(--text)' : 'var(--text-muted)',
              minHeight: 32, padding: `0 var(--s-5)`, cursor: 'pointer',
              fontSize: 'var(--fs-14)',
            }}>
            {a.rotulo}
          </button>
        ))}
      </div>

      {aba === 'prontuario' && !p.prontuarioAcessivel ? (
        <section aria-label="Prontuário indisponível"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)',
                   display: 'grid', gap: 'var(--s-4)' }}>
          <p style={{ margin: 0 }}>
            {p.existeMasSemAcesso
              ? 'Paciente existe. Prontuário não compartilhado com você.'
              : 'Nenhum prontuário encontrado para este paciente.'}
          </p>
          {p.existeMasSemAcesso ? (
            <div style={{ display: 'flex', gap: 'var(--s-3)' }}>
              <Botao variante="secundario" onClick={p.aoSolicitarAcesso}>
                Solicitar acesso
              </Botao>
              <Botao variante="fantasma" onClick={() => setPedindoVidro(true)}>
                Quebra-vidro assistencial
              </Botao>
            </div>
          ) : null}

          {pedindoVidro ? (
            <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
              <label htmlFor="jv" style={{ fontSize: 'var(--fs-12)',
                                           color: 'var(--text-muted)' }}>
                Justificativa (mínimo 20 caracteres, registrada na auditoria)
              </label>
              <textarea id="jv" value={justificativa} rows={3}
                onChange={(e) => setJustificativa(e.target.value)}
                style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                         padding: 'var(--s-4)', background: 'var(--surface)',
                         color: 'var(--text)', fontFamily: 'var(--font-ui)' }} />
              <Botao
                disabled={justificativa.trim().length < 20}
                onClick={() => { void p.aoQuebrarVidro(justificativa.trim(), 4); }}>
                Confirmar quebra-vidro
              </Botao>
            </div>
          ) : null}
        </section>
      ) : null}

      {aba === 'conversas' ? (
        <section aria-label="Conversas do paciente"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          {conversas === null ? (
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>Carregando conversas...</p>
          ) : conversas.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>Nenhuma conversa com este paciente.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid',
                         gap: 'var(--s-3)' }}>
              {conversas.map((msg) => (
                <li key={msg.messageId} style={{ display: 'flex', gap: 'var(--s-4)',
                                                  padding: 'var(--s-3) 0',
                                                  borderBottom: 'var(--border)' }}>
                  <span style={{ fontSize: 'var(--fs-11)', color: 'var(--text-faint)',
                                 minWidth: '3ch', textAlign: 'right' }}>
                    {msg.direction === 'inbound' ? '←' : '→'}
                  </span>
                  <span style={{ flex: 1, fontSize: 'var(--fs-13)' }}>{msg.bodyPreview}</span>
                  <span style={{ fontSize: 'var(--fs-11)', color: 'var(--text-muted)' }}>
                    {msg.sentAt}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {aba === 'financeiro' ? (
        <section aria-label="Financeiro do paciente"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          {lancamentos === null ? (
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>Carregando financeiro...</p>
          ) : lancamentos.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>Nenhum lançamento para este paciente.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid',
                         gap: 'var(--s-3)' }}>
              {lancamentos.map((l) => (
                <li key={l.entryId} style={{ display: 'flex', justifyContent: 'space-between',
                                             padding: 'var(--s-3) 0',
                                             borderBottom: 'var(--border)' }}>
                  <span style={{ fontSize: 'var(--fs-13)' }}>{l.description}</span>
                  <span style={{ fontSize: 'var(--fs-13)', fontWeight: 'var(--fw-medium)' }}>
                    {`R$ ${(Math.abs(l.amountCents) / 100).toFixed(2).replace('.', ',')}`}
                  </span>
                  <span style={{
                    fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                    color: l.status === 'paid' ? 'var(--success)'
                         : l.status === 'overdue' ? 'var(--danger)'
                         : 'var(--text-muted)',
                  }}>
                    {l.status === 'paid' ? 'Pago' : l.status === 'overdue' ? 'Vencido'
                     : l.status === 'pending' ? 'Pendente' : 'Cancelado'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
```

- [ ] Escrever os testes completos.

```ts
// apps/web/src/telas/FichaDoPaciente.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FichaDoPaciente } from './FichaDoPaciente';

const PACIENTE = { patientId: 'p1', displayName: 'Maria Souza Lima',
                   legalName: 'Maria Souza Lima', hasSocialName: false,
                   birthDate: '1988-03-14', cadastroStatus: 'preliminar' as const,
                   phonePrimary: '11987654321' };

const CONVERSAS = [
  { messageId: 'm1', direction: 'inbound' as const, bodyPreview: 'Boa tarde, posso remarcar?',
    sentAt: '04/08/2026 14:30', status: 'read' as const },
  { messageId: 'm2', direction: 'outbound' as const, bodyPreview: 'Sim! Qual dia prefere?',
    sentAt: '04/08/2026 14:32', status: 'delivered' as const },
];

const LANCAMENTOS = [
  { entryId: 'e1', description: 'Consulta particular', amountCents: 30000,
    status: 'paid' as const, dueDate: '2026-08-03', paidAt: '2026-08-03' },
  { entryId: 'e2', description: 'Retorno', amountCents: 15000,
    status: 'pending' as const, dueDate: '2026-08-10', paidAt: null },
];

function montar(over = {}) {
  const props = {
    paciente: PACIENTE, papel: 'profissional' as const,
    pendentes: ['cpf'], carregarProntuario: vi.fn(async () => [] as unknown[]),
    prontuarioAcessivel: true, existeMasSemAcesso: false,
    aoSolicitarAcesso: vi.fn(), aoQuebrarVidro: vi.fn(async () => {}),
    carregarConversas: vi.fn(async () => CONVERSAS),
    carregarFinanceiro: vi.fn(async () => LANCAMENTOS),
    podeVerFinanceiro: false,
    ...over,
  };
  render(<FichaDoPaciente {...props} />);
  return props;
}

describe('ficha do paciente', () => {
  it('recepcao NAO ve a aba Prontuario — ela nao existe, nao esta cinza', () => {
    montar({ papel: 'recepcao', prontuarioAcessivel: false });
    expect(screen.queryByRole('tab', { name: 'Prontuário' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Atendimentos' })).toBeVisible();
  });

  it('profissional ve Prontuario e NAO ve o substituto administrativo em destaque', () => {
    montar();
    expect(screen.getByRole('tab', { name: 'Prontuário' })).toBeVisible();
  });

  it('o TERCEIRO ESTADO aparece com as duas saidas nomeadas', async () => {
    montar({ prontuarioAcessivel: false, existeMasSemAcesso: true });
    await userEvent.click(screen.getByRole('tab', { name: 'Prontuário' }));
    expect(screen.getByText(/Paciente existe\. Prontuário não compartilhado com você\./))
      .toBeVisible();
    expect(screen.getByRole('button', { name: 'Solicitar acesso' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Quebra-vidro assistencial' })).toBeVisible();
  });

  it('quebra-vidro EXIGE justificativa de 20 caracteres antes de habilitar', async () => {
    const { aoQuebrarVidro } = montar({ prontuarioAcessivel: false, existeMasSemAcesso: true });
    await userEvent.click(screen.getByRole('tab', { name: 'Prontuário' }));
    await userEvent.click(screen.getByRole('button', { name: 'Quebra-vidro assistencial' }));
    const confirmar = screen.getByRole('button', { name: 'Confirmar quebra-vidro' });
    expect(confirmar).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Justificativa/),
      'paciente inconsciente no pronto atendimento');
    expect(confirmar).toBeEnabled();
    await userEvent.click(confirmar);
    expect(aoQuebrarVidro).toHaveBeenCalledWith(
      'paciente inconsciente no pronto atendimento', 4);
  });

  it('a barra de dados pendentes diz QUANTOS e quais', () => {
    montar({ pendentes: ['cpf', 'sex_at_birth'] });
    expect(screen.getByText('2 dados pendentes')).toBeVisible();
  });

  it('aba Conversas aparece para todos os papeis e carrega mensagens sob demanda', async () => {
    const { carregarConversas } = montar({ papel: 'recepcao' });
    expect(screen.getByRole('tab', { name: 'Conversas' })).toBeVisible();
    expect(carregarConversas).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('tab', { name: 'Conversas' }));
    expect(carregarConversas).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(
      screen.getByText('Boa tarde, posso remarcar?')).toBeVisible());
  });

  it('recepcao ve Conversas mas NAO ve conteudo clinico no contexto', async () => {
    montar({ papel: 'recepcao', prontuarioAcessivel: false });
    await userEvent.click(screen.getByRole('tab', { name: 'Conversas' }));
    await waitFor(() => expect(
      screen.getByRole('region', { name: 'Conversas do paciente' })).toBeVisible());
    expect(screen.queryByRole('tab', { name: 'Prontuário' })).not.toBeInTheDocument();
  });

  it('aba Financeiro aparece para papel financeiro e mostra lancamentos', async () => {
    const { carregarFinanceiro } = montar({ papel: 'financeiro' });
    expect(screen.getByRole('tab', { name: 'Financeiro' })).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: 'Financeiro' }));
    expect(carregarFinanceiro).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(
      screen.getByText('Consulta particular')).toBeVisible());
    expect(screen.getByText('Pago')).toBeVisible();
    expect(screen.getByText('Pendente')).toBeVisible();
  });

  it('recepcao NAO ve aba Financeiro a menos que podeVerFinanceiro=true', () => {
    montar({ papel: 'recepcao', podeVerFinanceiro: false });
    expect(screen.queryByRole('tab', { name: 'Financeiro' })).not.toBeInTheDocument();
  });

  it('recepcao ve aba Financeiro quando podeVerFinanceiro=true', () => {
    montar({ papel: 'recepcao', podeVerFinanceiro: true });
    expect(screen.getByRole('tab', { name: 'Financeiro' })).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FichaDoPaciente paciente={PACIENTE} papel="profissional" pendentes={[]}
        carregarProntuario={async () => []} prontuarioAcessivel existeMasSemAcesso={false}
        aoSolicitarAcesso={vi.fn()} aoQuebrarVidro={async () => {}}
        carregarConversas={async () => []} carregarFinanceiro={async () => []}
        podeVerFinanceiro={false} />);
    await waitFor(() => expect(screen.getAllByRole('tab').length).toBeGreaterThan(0));
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar `pnpm vitest run apps/web/src/telas/FichaDoPaciente.test.tsx` e confirmar que todos os 11 testes passam.

Saida esperada: 11 testes passando.

- [ ] Commitar: `feat(web): add Conversas and Financeiro tabs to patient record`

---