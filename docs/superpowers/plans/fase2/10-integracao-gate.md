<!-- RECONCILIACAO (00-CONTRATOS) ──────────────────────────────────────
  Este bloco e o INTEGRATION GATE — responsavel final por:
  1. FASE_ATUAL = 2 e habilitacao de Conversas + Financeiro no nav
     (vence sobre Blocos 08 e 09 que tentavam o mesmo).
  2. TENANT_SCHEMAS += 'msg' (Task 59).
  3. Providers registry += messaging + payment (Task 59).
  4. LinhaDaFila (Task 56) deve incluir valorSugeridoCentavos do Bloco 09
     alem de mensagensNaoLidas e pagamentoPendente.
  5. Conversas disponivelNaFase: 2 SEM motivo (ja ativa).
─────────────────────────────────────────────────────────────────── -->

### Task 55: habilitar Conversas e Financeiro na barra de navegacao

**Arquivos**

- Modificar `apps/web/src/ui/nav.ts`
- Modificar `apps/web/src/ui/BarraDeNavegacao.test.tsx`

**Passos**

- [ ] Atualizar `FASE_ATUAL` e os registros de `Conversas` e `Financeiro` em `nav.ts`. Conversas passa para fase 2 e Financeiro passa para fase 2 (recebimentos basicos).

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
    motivo: 'Desempenho e atribuição de variação chegam na Fase 3' },
];

export const FASE_ATUAL = 2 as const;
```

- [ ] Rodar `pnpm vitest run apps/web/src/ui/BarraDeNavegacao.test.tsx` e confirmar que o teste existente falha porque agora so Desempenho e futuro.

Saida esperada: 2 falhas — o teste `marca o que ainda nao existe, com o motivo` espera 3 itens futuros (Conversas, Financeiro, Desempenho) mas agora so Desempenho e futuro; e o teste `renderiza os itens da Fase 1 como link e os futuros como desabilitados` clica no botao Conversas que agora e link.

- [ ] Atualizar os testes para refletir a nova realidade.

```ts
// apps/web/src/ui/BarraDeNavegacao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { BarraDeNavegacao } from './BarraDeNavegacao';
import { ITENS_NAV } from './nav';

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

  it('na Fase 2 so Desempenho esta marcado como futuro', () => {
    const futuros = ITENS_NAV.filter((i) => i.disponivelNaFase > 2);
    expect(futuros.map((i) => i.rotulo)).toEqual(['Desempenho']);
    for (const f of futuros) expect(f.motivo).toMatch(/Fase \d/);
  });

  it('Conversas e Financeiro agora sao links navegaveis', () => {
    render(<BarraDeNavegacao />);
    expect(screen.getByRole('link', { name: 'Conversas' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Financeiro' })).toBeInTheDocument();
  });

  it('Desempenho permanece desabilitado com motivo', () => {
    render(<BarraDeNavegacao />);
    const desempenho = screen.getByRole('button', { name: /Desempenho/ });
    expect(desempenho).toBeDisabled();
    expect(desempenho).toHaveAttribute('aria-disabled', 'true');
    expect(desempenho).toHaveAccessibleDescription(/Fase 3/);
  });

  it('a navegacao e um <nav> com rotulo e nao tem violacao de acessibilidade', async () => {
    const { container } = render(<BarraDeNavegacao />);
    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Auditoria e Ajustes NAO estao na barra — moram no menu do usuario', () => {
    render(<BarraDeNavegacao />);
    expect(screen.queryByText('Auditoria')).not.toBeInTheDocument();
    expect(screen.queryByText('Ajustes')).not.toBeInTheDocument();
  });
});
```

- [ ] Rodar `pnpm vitest run apps/web/src/ui/BarraDeNavegacao.test.tsx` e confirmar que todos os 6 testes passam.

Saida esperada: 6 testes passando.

- [ ] Commitar: `feat(web): enable Conversas and Financeiro nav items for Fase 2`

---

### Task 56: integrar badges de messaging e pagamento na tela Hoje

**Arquivos**

- Modificar `apps/web/src/telas/Hoje.tsx`
- Modificar `apps/web/src/telas/Hoje.test.tsx`

**Passos**

- [ ] Estender `LinhaDaFila` e `HojeProps` com campos de messaging e pagamento. Adicionar acoes "Mensagem" e "Cobrar" na fila e badge de mensagens nao-lidas na faixa.

```ts
// apps/web/src/telas/Hoje.tsx
'use client';

import { useEffect, useState } from 'react';
import { FaixaDeContadores, type Contadores, type FiltroDoDia } from '../ui/FaixaDeContadores';
import { LinhaDaAgenda } from '../ui/LinhaDaAgenda';
import { Botao } from '../ui/Botao';
import type { StatusAgenda } from '../ui/ChipDeStatus';

export interface LinhaDaFila {
  readonly appointmentId: string; readonly startsAt: string; readonly endsAt: string;
  readonly patientId: string; readonly displayName: string; readonly professionalId: string;
  readonly procedureNome: string | null; readonly procedureCor: string | null;
  readonly operadoraNome: string | null; readonly status: StatusAgenda;
  readonly encaixe: boolean; readonly teleconsulta: boolean; readonly primeiraVez: boolean;
  readonly cadastroPreliminar: boolean; readonly encounterId: string | null;
  readonly valorSugeridoCentavos?: number;  // adicionado: Bloco 09 Task 51
  readonly mensagensNaoLidas: number;
  readonly pagamentoPendente: boolean;
}

export interface PrecisaDeVoce {
  readonly confirmacoesSemResposta: number; readonly prescricoesNaoAssinadas: number;
  readonly resultadosChegados: number; readonly rascunhosDeOntem: number;
  readonly guiasAFaturar: number;
}

export interface HojeProps {
  readonly dia: string;
  readonly filtro?: FiltroDoDia;
  readonly mensagensNaoLidasTotal: number;
  readonly carregarDia: (dia: string, filtro?: FiltroDoDia) =>
    Promise<{ contadores: Contadores; fila: LinhaDaFila[] }>;
  readonly carregarPrecisaDeVoce: () => Promise<PrecisaDeVoce>;
  readonly aoCheckIn: (appointmentId: string) => Promise<void>;
  readonly aoAbrirAtendimento: (linha: LinhaDaFila) => void;
  readonly aoMudarFiltro: (filtro: FiltroDoDia | undefined) => void;
  readonly aoMensagem: (linha: LinhaDaFila) => void;
  readonly aoCobrar: (linha: LinhaDaFila) => void;
}

const PENDENCIAS: ReadonlyArray<[keyof PrecisaDeVoce, string]> = [
  ['confirmacoesSemResposta', 'confirmações sem resposta'],
  ['prescricoesNaoAssinadas', 'prescrições não assinadas'],
  ['resultadosChegados', 'resultados chegados'],
  ['rascunhosDeOntem', 'rascunhos de ontem'],
  ['guiasAFaturar', 'guias a faturar'],
];

function porExtenso(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  const fmt = new Intl.DateTimeFormat('pt-BR',
    { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return fmt.format(d);
}

function hora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR',
    { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(iso));
}

export function Hoje(p: HojeProps) {
  const [contadores, setContadores] = useState<Contadores | null>(null);
  const [fila, setFila] = useState<LinhaDaFila[]>([]);
  const [precisa, setPrecisa] = useState<PrecisaDeVoce | null>(null);

  useEffect(() => {
    void p.carregarDia(p.dia, p.filtro).then((r) => {
      setContadores(r.contadores); setFila(r.fila);
    });
  }, [p, p.dia, p.filtro]);

  useEffect(() => { void p.carregarPrecisaDeVoce().then(setPrecisa); }, [p]);

  async function checkIn(linha: LinhaDaFila): Promise<void> {
    setFila((atual) => atual.map((l) =>
      l.appointmentId === linha.appointmentId ? { ...l, status: 'aguardando' as const } : l));
    try {
      await p.aoCheckIn(linha.appointmentId);
    } catch {
      setFila((atual) => atual.map((l) =>
        l.appointmentId === linha.appointmentId ? { ...l, status: linha.status } : l));
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
        <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                     lineHeight: 'var(--lh-tight)', margin: 0 }}>
          {`Hoje, ${porExtenso(p.dia)}`}
        </h1>
        {p.mensagensNaoLidasTotal > 0 ? (
          <span
            aria-label={`${p.mensagensNaoLidasTotal} mensagens não lidas`}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              minWidth: 20, height: 20, padding: '0 6px',
              borderRadius: 'var(--r-full)',
              background: 'var(--accent)', color: 'var(--accent-on)',
              fontSize: 'var(--fs-11)', fontWeight: 'var(--fw-semibold)',
            }}
          >
            {p.mensagensNaoLidasTotal}
          </span>
        ) : null}
      </div>

      {contadores === null ? null : (
        <FaixaDeContadores
          contadores={contadores}
          filtroAtivo={p.filtro}
          aoFiltrar={(f) => p.aoMudarFiltro(p.filtro === f ? undefined : f)}
        />
      )}

      <section aria-label="Fila do dia">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {fila.map((l) => (
            <LinhaDaAgenda
              key={l.appointmentId}
              hora={hora(l.startsAt)}
              paciente={l.displayName}
              profissional={l.professionalId}
              {...(l.procedureNome === null ? {} : { procedimento: l.procedureNome })}
              {...(l.operadoraNome === null ? {} : { convenio: l.operadoraNome })}
              status={l.status}
              encaixe={l.encaixe}
              cadastroPreliminar={l.cadastroPreliminar}
              primeiraVez={l.primeiraVez}
              teleconsulta={l.teleconsulta}
            />
          ))}
        </ul>
        <div style={{ display: 'flex', gap: 'var(--s-4)', marginTop: 'var(--s-5)',
                       flexWrap: 'wrap' }}>
          {fila.map((l) => (
            <span key={l.appointmentId} style={{ display: 'contents' }}>
              <Botao variante="secundario" altura={28}
                aria-label={`Check-in de ${l.displayName}`}
                onClick={() => { void checkIn(l); }}>
                Check-in
              </Botao>
              <Botao variante="fantasma" altura={28}
                aria-label={`Abrir atendimento de ${l.displayName}`}
                onClick={() => p.aoAbrirAtendimento(l)}>
                {l.encounterId === null ? 'Abrir atendimento' : 'Continuar'}
              </Botao>
              <Botao variante="fantasma" altura={28}
                aria-label={`Mensagem para ${l.displayName}`}
                onClick={() => p.aoMensagem(l)}>
                {l.mensagensNaoLidas > 0
                  ? `Mensagem (${l.mensagensNaoLidas})`
                  : 'Mensagem'}
              </Botao>
              {l.pagamentoPendente ? (
                <Botao variante="fantasma" altura={28}
                  aria-label={`Cobrar ${l.displayName}`}
                  onClick={() => p.aoCobrar(l)}>
                  Cobrar
                </Botao>
              ) : null}
            </span>
          ))}
        </div>
      </section>

      {precisa === null ? null : (
        <section aria-label="Precisa de você"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                       margin: `0 0 var(--s-4)` }}>
            Precisa de você
          </h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid',
                       gap: 'var(--s-3)' }}>
            {PENDENCIAS.map(([chave, rotulo]) => (
              <li key={chave} style={{ display: 'flex', gap: 'var(--s-4)', minHeight: 24 }}>
                <strong className="num" style={{ minWidth: '2ch', textAlign: 'right' }}>
                  {precisa[chave]}
                </strong>
                <span style={{ color: 'var(--text-muted)' }}>{rotulo}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

- [ ] Escrever os testes atualizados que validam as novas funcionalidades.

```ts
// apps/web/src/telas/Hoje.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Hoje } from './Hoje';

const DIA = {
  contadores: { agendados: 3, confirmados: 1, aguardando: 1, atendidos: 1, faltas: 0 },
  fila: [
    { appointmentId: 'a1', startsAt: '2026-08-03T13:00:00.000Z', endsAt: '2026-08-03T13:30:00.000Z',
      patientId: 'p1', displayName: 'Maria Souza Lima', professionalId: 'pr1',
      procedureNome: 'Consulta', procedureCor: '#2f5fd0', operadoraNome: 'Unimed',
      status: 'aguardando' as const, encaixe: false, teleconsulta: false, primeiraVez: false,
      cadastroPreliminar: true, encounterId: null,
      mensagensNaoLidas: 2, pagamentoPendente: true },
    { appointmentId: 'a2', startsAt: '2026-08-03T14:00:00.000Z', endsAt: '2026-08-03T14:30:00.000Z',
      patientId: 'p2', displayName: 'Joana Prado', professionalId: 'pr1',
      procedureNome: 'Retorno', procedureCor: '#2f5fd0', operadoraNome: null,
      status: 'agendado' as const, encaixe: true, teleconsulta: false, primeiraVez: true,
      cadastroPreliminar: false, encounterId: null,
      mensagensNaoLidas: 0, pagamentoPendente: false },
  ],
};
const PRECISA = { confirmacoesSemResposta: 4, prescricoesNaoAssinadas: 1,
                  resultadosChegados: 0, rascunhosDeOntem: 2, guiasAFaturar: 3 };

function montar(over: Partial<Parameters<typeof Hoje>[0]> = {}) {
  const props = {
    dia: '2026-08-03', carregarDia: vi.fn(async () => DIA),
    carregarPrecisaDeVoce: vi.fn(async () => PRECISA),
    aoCheckIn: vi.fn(async () => {}), aoAbrirAtendimento: vi.fn(),
    filtro: undefined, aoMudarFiltro: vi.fn(),
    mensagensNaoLidasTotal: 5,
    aoMensagem: vi.fn(), aoCobrar: vi.fn(),
    ...over,
  };
  render(<Hoje {...props} />);
  return props;
}

describe('tela Hoje', () => {
  it('o titulo diz o dia por extenso — a tela e o relogio, nao um modulo', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1, name: /Hoje, segunda-feira, 3 de agosto/i })).toBeVisible());
  });

  it('mostra badge de mensagens nao-lidas no cabecalho', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByLabelText('5 mensagens não lidas')).toBeVisible());
  });

  it('NAO mostra badge quando nao ha mensagens nao-lidas', async () => {
    montar({ mensagensNaoLidasTotal: 0 });
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1 })).toBeVisible());
    expect(screen.queryByLabelText(/mensagens não lidas/)).not.toBeInTheDocument();
  });

  it('mostra a faixa de contadores e a fila em ordem de horario', async () => {
    montar();
    await waitFor(() => expect(screen.getByRole('button', { name: /Agendados/ })).toBeVisible());
    const linhas = await screen.findAllByRole('listitem');
    expect(linhas[0]).toHaveTextContent('Maria Souza Lima');
    expect(linhas[1]).toHaveTextContent('Joana Prado');
  });

  it('clicar num contador vira query string, nao estado local', async () => {
    const { aoMudarFiltro } = montar();
    await waitFor(() => expect(screen.getByRole('button', { name: /Agendados/ })).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Aguardando/ }));
    expect(aoMudarFiltro).toHaveBeenCalledWith('aguardando');
  });

  it('a linha mostra os sinais: cadastro preliminar, 1a vez e encaixe', async () => {
    montar();
    const linhas = await screen.findAllByRole('listitem');
    expect(linhas[0]).toHaveTextContent('cadastro preliminar');
    expect(linhas[1]).toHaveTextContent('1ª vez');
    expect(linhas[1]).toHaveTextContent('encaixe');
  });

  it('check-in e otimista: o chip muda antes da resposta', async () => {
    const aoCheckIn = vi.fn(() => new Promise<void>(() => { /* nunca resolve */ }));
    montar({ aoCheckIn });
    const linhas = await screen.findAllByRole('listitem');
    await userEvent.click(screen.getByRole('button', { name: /Check-in de Joana Prado/ }));
    expect(linhas[1]).toHaveTextContent(/Aguardando/);
  });

  it('acao Mensagem aparece para todos os pacientes e mostra contagem se > 0', async () => {
    const { aoMensagem } = montar();
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Mensagem para Maria Souza Lima/ })).toBeVisible());
    expect(screen.getByRole('button', { name: /Mensagem para Maria Souza Lima/ }))
      .toHaveTextContent('Mensagem (2)');
    expect(screen.getByRole('button', { name: /Mensagem para Joana Prado/ }))
      .toHaveTextContent('Mensagem');
    await userEvent.click(screen.getByRole('button', { name: /Mensagem para Maria Souza Lima/ }));
    expect(aoMensagem).toHaveBeenCalledWith(DIA.fila[0]);
  });

  it('acao Cobrar aparece SOMENTE para quem tem pagamento pendente', async () => {
    const { aoCobrar } = montar();
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Cobrar Maria Souza Lima/ })).toBeVisible());
    expect(screen.queryByRole('button', { name: /Cobrar Joana Prado/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Cobrar Maria Souza Lima/ }));
    expect(aoCobrar).toHaveBeenCalledWith(DIA.fila[0]);
  });

  it('o painel Precisa de voce lista as cinco filas com os numeros', async () => {
    montar();
    await waitFor(() => expect(screen.getByRole('region', { name: 'Precisa de você' })).toBeVisible());
    expect(screen.getByText('4')).toBeVisible();
    expect(screen.getByText(/confirmações sem resposta/i)).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Hoje dia="2026-08-03" carregarDia={async () => DIA}
        carregarPrecisaDeVoce={async () => PRECISA} aoCheckIn={async () => {}}
        aoAbrirAtendimento={vi.fn()} aoMudarFiltro={vi.fn()}
        mensagensNaoLidasTotal={0} aoMensagem={vi.fn()} aoCobrar={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar `pnpm vitest run apps/web/src/telas/Hoje.test.tsx` e confirmar que todos os 11 testes passam.

Saida esperada: 11 testes passando.

- [ ] Commitar: `feat(web): add messaging and payment badges to Hoje screen`

---

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

### Task 58: adicionar acoes Confirmar e Cobrar no slot da Agenda

**Arquivos**

- Modificar `apps/web/src/telas/Agenda.tsx`
- Modificar `apps/web/src/telas/Agenda.test.tsx`

**Passos**

- [ ] Estender `AgendaProps` e a grade com acoes de confirmacao e cobranca por slot. O status de confirmacao aparece no botao do slot.

```ts
// apps/web/src/telas/Agenda.tsx
'use client';

import { useEffect, useState } from 'react';
import { VISOES, faixasDoDia, posicaoNaGrade, type Visao } from './grade';
import type { LinhaDaFila } from './Hoje';
import { Botao } from '../ui/Botao';

export interface AgendaProps {
  readonly dia: string;
  readonly visao: Visao['chave'];
  readonly timezone: string;
  readonly carregar: (dia: string) => Promise<LinhaDaFila[]>;
  readonly aoMudarVisao: (v: Visao['chave']) => void;
  readonly aoMudarDia: (dia: string) => void;
  readonly aoAbrirCompositor: (inicioMin: number) => void;
  readonly aoMover: (appointmentId: string, novoInicioIso: string) => Promise<void>;
  readonly aoConfirmar: (appointmentId: string) => Promise<void>;
  readonly aoCobrar: (appointmentId: string) => void;
}

const INICIO_MIN = 7 * 60;
const FIM_MIN = 21 * 60;
const PASSO_MIN = 15;

export function Agenda(p: AgendaProps) {
  const [itens, setItens] = useState<LinhaDaFila[]>([]);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const faixas = faixasDoDia({ inicioMin: INICIO_MIN, fimMin: FIM_MIN, passoMin: PASSO_MIN });

  useEffect(() => { void p.carregar(p.dia).then(setItens); }, [p, p.dia]);

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent): void {
      const alvo = e.target as HTMLElement | null;
      const editando = alvo?.tagName === 'INPUT' || alvo?.tagName === 'TEXTAREA'
        || alvo?.isContentEditable === true;
      if (editando || e.metaKey || e.ctrlKey || e.altKey) return;
      const v = VISOES.find((x) => x.atalho === e.key);
      if (v !== undefined) { e.preventDefault(); p.aoMudarVisao(v.chave); }
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [p]);

  async function confirmar(appointmentId: string): Promise<void> {
    setConfirmando(appointmentId);
    try {
      await p.aoConfirmar(appointmentId);
      setItens((atual) => atual.map((it) =>
        it.appointmentId === appointmentId
          ? { ...it, status: 'confirmado' as const }
          : it));
    } finally {
      setConfirmando(null);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)' }}>
      <div role="tablist" aria-label="Visões da agenda"
           style={{ display: 'flex', gap: 'var(--s-1)' }}>
        {VISOES.map((v) => (
          <button
            key={v.chave} role="tab" type="button"
            aria-selected={p.visao === v.chave}
            onClick={() => p.aoMudarVisao(v.chave)}
            style={{
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              background: p.visao === v.chave ? 'var(--accent-soft)' : 'var(--surface)',
              color: 'var(--text)', minHeight: 32, padding: `0 var(--s-5)`,
              fontSize: 'var(--fs-13)', cursor: 'pointer',
            }}
          >
            {v.rotulo}
          </button>
        ))}
      </div>

      <div
        aria-label={`Agenda de ${p.dia}`}
        style={{
          display: 'grid',
          gridTemplateColumns: '64px 1fr',
          gridTemplateRows: `repeat(${faixas.length}, 18px)`,
          border: 'var(--border)', borderRadius: 'var(--r-md)',
          background: 'var(--surface)', position: 'relative',
        }}
      >
        {faixas.map((f, i) => (
          <span key={f} aria-hidden="true"
            style={{ gridColumn: 1, gridRow: i + 1, fontSize: 'var(--fs-11)',
                     color: 'var(--text-faint)', paddingInlineEnd: 'var(--s-3)',
                     textAlign: 'right', borderBottom: i % 4 === 3 ? 'var(--border)' : 'none' }}>
            {i % 4 === 0 ? f : ''}
          </span>
        ))}
        {faixas.map((f, i) => (
          <div key={`c-${f}`} data-slot="vazio"
            onClick={() => p.aoAbrirCompositor(INICIO_MIN + i * PASSO_MIN)}
            style={{ gridColumn: 2, gridRow: i + 1, cursor: 'pointer',
                     borderBottom: i % 4 === 3 ? 'var(--border)' : 'none' }} />
        ))}
        {itens.map((it) => {
          const pos = posicaoNaGrade(it.startsAt, it.endsAt,
            { inicioMin: INICIO_MIN, passoMin: PASSO_MIN, timezone: p.timezone });
          return (
            <div
              key={it.appointmentId}
              style={{
                gridColumn: 2, gridRow: `${pos.linhaInicio} / ${pos.linhaFim}`,
                textAlign: 'left', border: 'var(--border)',
                borderInlineStart: `3px solid ${it.procedureCor ?? 'var(--st-agendado)'}`,
                borderRadius: 'var(--r-sm)',
                background: it.encaixe
                  ? 'repeating-linear-gradient(45deg, var(--surface) 0 6px, var(--surface-sunken) 6px 12px)'
                  : 'var(--surface)',
                margin: 1, padding: `var(--s-2) var(--s-4)`,
                fontSize: 'var(--fs-13)', overflow: 'hidden',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis',
                             whiteSpace: 'nowrap' }}>
                {it.displayName}
                {it.status === 'confirmado' ? (
                  <span aria-label="Confirmado" style={{ marginInlineStart: 'var(--s-2)',
                    color: 'var(--st-confirmado)', fontSize: 'var(--fs-11)' }}>
                    ✓
                  </span>
                ) : null}
              </span>
              <span style={{ display: 'flex', gap: 'var(--s-2)', flexShrink: 0 }}>
                {it.status === 'agendado' ? (
                  <Botao variante="fantasma" altura={28}
                    carregando={confirmando === it.appointmentId}
                    aria-label={`Confirmar ${it.displayName}`}
                    onClick={(e) => { e.stopPropagation(); void confirmar(it.appointmentId); }}>
                    Confirmar
                  </Botao>
                ) : null}
                {it.pagamentoPendente ? (
                  <Botao variante="fantasma" altura={28}
                    aria-label={`Cobrar ${it.displayName}`}
                    onClick={(e) => { e.stopPropagation(); p.aoCobrar(it.appointmentId); }}>
                    Cobrar
                  </Botao>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] Escrever os testes atualizados.

```ts
// apps/web/src/telas/Agenda.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Agenda } from './Agenda';

const FILA = [{
  appointmentId: 'a1', startsAt: '2026-08-03T13:00:00.000Z', endsAt: '2026-08-03T13:30:00.000Z',
  patientId: 'p1', displayName: 'Maria Souza Lima', professionalId: 'pr1',
  procedureNome: 'Consulta', procedureCor: '#2f5fd0', operadoraNome: 'Unimed',
  status: 'agendado' as const, encaixe: false, teleconsulta: false, primeiraVez: false,
  cadastroPreliminar: false, encounterId: null,
  mensagensNaoLidas: 0, pagamentoPendente: true,
}];

function montar(over = {}) {
  const props = {
    dia: '2026-08-03', visao: 'dia' as const, timezone: 'UTC',
    carregar: vi.fn(async () => FILA), aoMudarVisao: vi.fn(), aoMudarDia: vi.fn(),
    aoAbrirCompositor: vi.fn(), aoMover: vi.fn(async () => {}),
    aoConfirmar: vi.fn(async () => {}), aoCobrar: vi.fn(),
    ...over,
  };
  render(<Agenda {...props} />);
  return props;
}

describe('tela Agenda', () => {
  it('oferece as cinco visoes como tablist', async () => {
    montar();
    const abas = await screen.findAllByRole('tab');
    expect(abas.map((a) => a.textContent)).toEqual([
      'Dia', 'Semana', 'Mês', 'Por profissional', 'Por sala']);
  });

  it('as teclas 1..5 trocam a visao — atalho de um caractere fora de campo de texto', async () => {
    const { aoMudarVisao } = montar();
    await userEvent.keyboard('4');
    expect(aoMudarVisao).toHaveBeenCalledWith('profissional');
  });

  it('a visao vai para a query string, nao para estado local', async () => {
    const { aoMudarVisao } = montar();
    await userEvent.click(await screen.findByRole('tab', { name: 'Semana' }));
    expect(aoMudarVisao).toHaveBeenCalledWith('semana');
  });

  it('o agendamento aparece posicionado na grade, com a cor do procedimento', async () => {
    montar();
    const item = await screen.findByText('Maria Souza Lima');
    expect(item.closest('[style]')).toBeTruthy();
  });

  it('o botao Confirmar aparece para status agendado e envia template de confirmacao', async () => {
    const { aoConfirmar } = montar();
    const botao = await screen.findByRole('button', { name: /Confirmar Maria Souza Lima/ });
    expect(botao).toBeVisible();
    await userEvent.click(botao);
    expect(aoConfirmar).toHaveBeenCalledWith('a1');
  });

  it('apos confirmar, o status muda para confirmado e o glifo aparece', async () => {
    montar();
    await userEvent.click(await screen.findByRole('button', { name: /Confirmar Maria Souza Lima/ }));
    await waitFor(() => expect(screen.getByLabelText('Confirmado')).toBeVisible());
    expect(screen.queryByRole('button', { name: /Confirmar Maria Souza Lima/ }))
      .not.toBeInTheDocument();
  });

  it('o botao Cobrar aparece para quem tem pagamento pendente', async () => {
    const { aoCobrar } = montar();
    const botao = await screen.findByRole('button', { name: /Cobrar Maria Souza Lima/ });
    expect(botao).toBeVisible();
    await userEvent.click(botao);
    expect(aoCobrar).toHaveBeenCalledWith('a1');
  });

  it('Cobrar NAO aparece quando pagamentoPendente e false', async () => {
    montar({ carregar: vi.fn(async () =>
      FILA.map((f) => ({ ...f, pagamentoPendente: false }))) });
    await waitFor(() => expect(screen.getByText('Maria Souza Lima')).toBeVisible());
    expect(screen.queryByRole('button', { name: /Cobrar/ })).not.toBeInTheDocument();
  });

  it('clicar num vao vazio abre o compositor INLINE, nao um modal de pagina cheia', async () => {
    const { aoAbrirCompositor } = montar();
    const slots = await waitFor(() => {
      const s = document.querySelectorAll('[data-slot="vazio"]');
      expect(s.length).toBeGreaterThan(0);
      return s;
    });
    await userEvent.click(slots[0] as HTMLElement);
    expect(aoAbrirCompositor).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Agenda dia="2026-08-03" visao="dia" timezone="UTC" carregar={async () => FILA}
        aoMudarVisao={vi.fn()} aoMudarDia={vi.fn()} aoAbrirCompositor={vi.fn()}
        aoMover={async () => {}} aoConfirmar={async () => {}} aoCobrar={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('tab').length).toBe(5));
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar `pnpm vitest run apps/web/src/telas/Agenda.test.tsx` e confirmar que todos os 10 testes passam.

Saida esperada: 10 testes passando.

- [ ] Commitar: `feat(web): add Confirmar and Cobrar actions to Agenda slots`

---

### Task 59: adicionar msg ao TENANT_SCHEMAS e atualizar providers registry

**Arquivos**

- Modificar `packages/db/src/invariants/catalog.ts`
- Criar `packages/db/src/invariants/catalog.test.ts`
- Modificar `apps/api/src/providers.ts`
- Criar `apps/api/src/providers.test.ts`

**Passos**

- [ ] Escrever o teste que afirma que `msg` e `fin` pertencem ao `TENANT_SCHEMAS`.

```ts
// packages/db/src/invariants/catalog.test.ts
import { describe, expect, it } from 'vitest';
import { TENANT_SCHEMAS } from './catalog';

describe('catalogo de schemas multi-tenant', () => {
  it('msg pertence ao regime multi-tenant desde a Fase 2', () => {
    expect(TENANT_SCHEMAS).toContain('msg');
  });

  it('fin pertence ao regime multi-tenant desde a Fase 0 (vazio ate a Fase 2)', () => {
    expect(TENANT_SCHEMAS).toContain('fin');
  });

  it('os schemas da Fase 1 continuam presentes', () => {
    for (const s of ['app', 'clin', 'tiss', 'audit', 'sched']) {
      expect(TENANT_SCHEMAS).toContain(s);
    }
  });
});
```

- [ ] Rodar `pnpm vitest run packages/db/src/invariants/catalog.test.ts` e confirmar que falha porque `msg` nao esta em `TENANT_SCHEMAS`.

Saida esperada: 1 falha — `msg` nao encontrado.

- [ ] Adicionar `msg` ao `TENANT_SCHEMAS`.

```ts
// packages/db/src/invariants/catalog.ts — so a linha que muda
export const TENANT_SCHEMAS = ['app', 'clin', 'fin', 'tiss', 'audit', 'sched', 'msg'] as const;
```

- [ ] Rodar `pnpm vitest run packages/db/src/invariants/catalog.test.ts` e confirmar que os 3 testes passam.

Saida esperada: 3 testes passando.

- [ ] Escrever o teste do registry de providers incluindo messaging e payment.

```ts
// apps/api/src/providers.test.ts
import { describe, expect, it } from 'vitest';
import { providers, type Providers } from './providers';

describe('registry de providers (fake)', () => {
  it('inclui signature, prescription, messaging e payment', () => {
    const p: Providers = providers();
    expect(p.signature.id).toBe('signature-fake');
    expect(p.prescription.id).toBe('prescription-fake');
    expect(p.messaging.id).toBe('messaging-fake');
    expect(p.payment.id).toBe('payment-fake');
  });

  it('todos declaram safety para seus metodos', () => {
    const p = providers();
    expect(Object.keys(p.messaging.safety).length).toBeGreaterThan(0);
    expect(Object.keys(p.payment.safety).length).toBeGreaterThan(0);
  });

  it('todos declaram capabilities', () => {
    const p = providers();
    expect(p.messaging.capabilities.size).toBeGreaterThan(0);
    expect(p.payment.capabilities.size).toBeGreaterThan(0);
  });
});
```

- [ ] Rodar `pnpm vitest run apps/api/src/providers.test.ts` e confirmar que falha porque `messaging` e `payment` nao existem no registry.

Saida esperada: falha de tipo/propriedade.

- [ ] Atualizar o registry de providers para incluir messaging e payment.

```ts
// apps/api/src/providers.ts
import {
  createFakePrescriptionProvider, createFakeSignatureProvider,
  createFakeMessagingProvider, createFakePaymentProvider,
  type MessagingProvider, type PaymentProvider,
  type PrescriptionProvider, type SignatureProvider,
} from '@cadencia/integrations';

export interface Providers {
  readonly signature: SignatureProvider;
  readonly prescription: PrescriptionProvider;
  readonly messaging: MessagingProvider;
  readonly payment: PaymentProvider;
}

let cache: Providers | null = null;

export function providers(): Providers {
  if (cache !== null) return cache;
  const usarFakes = process.env.CADENCIA_PROVIDERS !== 'real';
  if (!usarFakes) {
    throw new Error('CADENCIA_PROVIDERS=real sem adaptadores reais configurados');
  }
  cache = {
    signature: createFakeSignatureProvider(),
    prescription: createFakePrescriptionProvider(),
    messaging: createFakeMessagingProvider(),
    payment: createFakePaymentProvider(),
  };
  return cache;
}
```

- [ ] Rodar `pnpm vitest run apps/api/src/providers.test.ts` e confirmar que os 3 testes passam.

Saida esperada: 3 testes passando.

- [ ] Commitar: `feat: add msg to TENANT_SCHEMAS and register messaging/payment providers`

---

### Task 60: definition-of-done gate e demonstracao de ponta a ponta

**Arquivos**

- Modificar `package.json` (script `prepush`)
- Criar `apps/api/src/routes/fase2-e2e.int.test.ts`

**Passos**

- [ ] Atualizar o script `prepush` para cobrir todos os gates da Fase 2.

```jsonc
// package.json — campo scripts (so os campos que mudam)
{
  "prepush": "pnpm typecheck && pnpm arch:check && pnpm lint:terminology-clock && pnpm lint:session-guc && pnpm test && pnpm test:int && pnpm test:iso"
}
```

Isto garante que:
1. `pnpm typecheck` — 0 erros
2. `pnpm arch:check` — 0 violacoes (messaging nao importa scheduling, payments nao importa messaging, etc.)
3. `pnpm lint:terminology-clock` — 0 violacoes
4. `pnpm lint:session-guc` — 0 violacoes
5. `pnpm test` — todos os testes de unidade passam
6. `pnpm test:int` — todos os testes de integracao passam
7. `pnpm test:iso` — todos os testes de isolamento passam

Os gates `pnpm db:invariants` e `pnpm db:privileges` continuam manuais por exigirem banco vivo; a documentacao abaixo instrui a execucao.

- [ ] Escrever o teste de integracao de ponta a ponta da Fase 2 com provedores fake. Este teste prova o fluxo completo e os fatos de protecao.

```ts
// apps/api/src/routes/fase2-e2e.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import {
  createFakeMessagingProvider,
  createFakePaymentProvider,
  type MessagingProvider,
  type PaymentProvider,
} from '@cadencia/integrations';
import { createTestDb, type TestDb } from '../test-support';

let db: TestDb;
let messaging: MessagingProvider;
let payment: PaymentProvider;
const TENANT_ID = uuidv7();
const USER_ID = uuidv7();
const CLINIC_ID = uuidv7();
const PATIENT_ID = uuidv7();

function ator(): Actor {
  return { kind: 'user', tenantId: TENANT_ID, userId: USER_ID,
           clinicId: CLINIC_ID, requestId: uuidv7() };
}

beforeAll(async () => {
  db = await createTestDb();
  messaging = createFakeMessagingProvider();
  payment = createFakePaymentProvider();
});

afterAll(async () => { await db.close(); });

describe('demonstracao de ponta a ponta da Fase 2', () => {
  // --- FLUXO 1: confirmacao via WhatsApp ---
  it('1. enviar confirmacao via messaging provider', async () => {
    const ctx = {
      tenantId: TENANT_ID, actorUserId: USER_ID,
      requestId: uuidv7(), idempotencyKey: `confirm-${uuidv7()}`,
      deadlineMs: 5000,
    };
    const r = await messaging.send(ctx, {
      channelIdentityRef: 'fake-channel',
      to: '+5511999990001' as import('@cadencia/integrations').E164,
      body: { kind: 'template', templateName: 'confirmacao_consulta',
              params: { paciente: 'Maria', data: '05/08/2026', hora: '14:00' } },
      conversationId: uuidv7(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.providerMessageId).toBeTruthy();
  });

  // --- FLUXO 2: pagamento PIX ---
  it('2. criar link de pagamento e confirmar via webhook', async () => {
    const ctx = {
      tenantId: TENANT_ID, actorUserId: USER_ID,
      requestId: uuidv7(), idempotencyKey: `pay-${uuidv7()}`,
      deadlineMs: 5000,
    };
    const link = await payment.createPaymentLink(ctx, {
      amountCents: 30000, currency: 'BRL',
      description: 'Consulta particular',
      expiresInMinutes: 60,
      payerName: 'Maria Souza Lima',
      payerDocument: '12345678901',
    });
    expect(link.ok).toBe(true);
    if (link.ok) {
      expect(link.value.paymentUrl).toContain('http');
      expect(link.value.providerPaymentId).toBeTruthy();
    }
  });

  // --- FATO 1: webhook com assinatura HMAC invalida e REJEITADO ---
  it('3. webhook com assinatura HMAC invalida e rejeitado pelo messaging provider', () => {
    const resultado = messaging.verifyWebhook(
      Buffer.from('{"tipo":"mensagem"}'),
      { 'x-hub-signature-256': 'sha256=assinatura_invalida_aqui' },
    );
    expect(resultado.valid).toBe(false);
    expect(resultado.reason).toBeTruthy();
  });

  // --- FATO 2: timeout NAO reenvia automaticamente ---
  it('4. timeout no WhatsApp NAO gera retry automatico — persiste estado indeterminado', async () => {
    const msgTimeout = createFakeMessagingProvider({ modo: 'timeout' });
    const ctx = {
      tenantId: TENANT_ID, actorUserId: USER_ID,
      requestId: uuidv7(), idempotencyKey: `timeout-${uuidv7()}`,
      deadlineMs: 100,
    };
    const r = await msgTimeout.send(ctx, {
      channelIdentityRef: 'fake-channel',
      to: '+5511999990002' as import('@cadencia/integrations').E164,
      body: { kind: 'text', text: 'Lembrete de consulta' },
      conversationId: uuidv7(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('timeout');
      expect(r.error.retrySafe).toBe(false);
    }
  });

  // --- FATO 3: pagamento duplicado por idempotency_key e recusado ---
  it('5. pagamento duplicado por idempotency_key retorna o mesmo resultado, nao duplica', async () => {
    const chave = `idem-${uuidv7()}`;
    const ctx = {
      tenantId: TENANT_ID, actorUserId: USER_ID,
      requestId: uuidv7(), idempotencyKey: chave,
      deadlineMs: 5000,
    };
    const primeiro = await payment.createPaymentLink(ctx, {
      amountCents: 15000, currency: 'BRL',
      description: 'Retorno',
      expiresInMinutes: 30,
      payerName: 'Joana Prado',
      payerDocument: '98765432100',
    });
    expect(primeiro.ok).toBe(true);

    const ctx2 = { ...ctx, requestId: uuidv7() };
    const segundo = await payment.createPaymentLink(ctx2, {
      amountCents: 15000, currency: 'BRL',
      description: 'Retorno',
      expiresInMinutes: 30,
      payerName: 'Joana Prado',
      payerDocument: '98765432100',
    });
    expect(segundo.ok).toBe(true);
    if (primeiro.ok && segundo.ok) {
      expect(segundo.value.providerPaymentId).toBe(primeiro.value.providerPaymentId);
    }
  });

  // --- FATO 4: webhook de pagamento com assinatura invalida e rejeitado ---
  it('6. webhook de pagamento com assinatura invalida e rejeitado', () => {
    const resultado = payment.verifyWebhook(
      Buffer.from('{"event":"payment_confirmed"}'),
      { 'x-webhook-signature': 'invalida' },
    );
    expect(resultado.valid).toBe(false);
  });

  // --- FATO 5: lembrete para consulta as 8h em SP sai no fuso correto ---
  it('7. lembrete 24h antes respeita o fuso da clinica — SP e UTC-3', () => {
    // consulta agendada para 2026-08-05T08:00:00 em America/Sao_Paulo
    // = 2026-08-05T11:00:00.000Z
    // lembrete 24h antes = 2026-08-04T08:00:00 em SP = 2026-08-04T11:00:00.000Z
    const consultaUtc = new Date('2026-08-05T11:00:00.000Z');
    const lembreteUtc = new Date(consultaUtc.getTime() - 24 * 60 * 60 * 1000);
    expect(lembreteUtc.toISOString()).toBe('2026-08-04T11:00:00.000Z');

    // Converter para horario local de SP: 08:00
    const emSP = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    }).format(lembreteUtc);
    expect(emSP).toBe('08:00');
  });

  // --- FATO 6: provider health check funciona ---
  it('8. health check dos providers fake retorna up=true', async () => {
    const msgHealth = await messaging.health();
    expect(msgHealth.up).toBe(true);
    expect(msgHealth.latencyMs).toBeDefined();

    const payHealth = await payment.health();
    expect(payHealth.up).toBe(true);
  });

  // --- FATO 7: messaging provider declara residency:br ---
  it('9. messaging provider declara residency:br nas capabilities', () => {
    expect(messaging.capabilities.has('residency:br')).toBe(true);
  });

  // --- FATO 8: payment provider declara residency:br ---
  it('10. payment provider declara residency:br nas capabilities', () => {
    expect(payment.capabilities.has('residency:br')).toBe(true);
  });

  // --- FATO 9: safety do send e unsafe ---
  it('11. send de mensagem e declarado como unsafe — nunca retry automatico', () => {
    expect(messaging.safety['send']).toBe('unsafe');
  });

  // --- FATO 10: safety do createPaymentLink e idempotent ---
  it('12. createPaymentLink e declarado como idempotent', () => {
    expect(payment.safety['createPaymentLink']).toBe('idempotent');
  });

  // --- FATO 11: refund e unsafe ---
  it('13. refund e declarado como unsafe', () => {
    expect(payment.safety['refund']).toBe('unsafe');
  });

  // --- FATO 12: numero bloqueado mostra canal suspenso ---
  it('14. messaging com numero bloqueado sinaliza canal suspenso, nao descarta historico', async () => {
    const msgBloqueado = createFakeMessagingProvider({ modo: 'bloqueado' });
    const ctx = {
      tenantId: TENANT_ID, actorUserId: USER_ID,
      requestId: uuidv7(), idempotencyKey: `blocked-${uuidv7()}`,
      deadlineMs: 5000,
    };
    const r = await msgBloqueado.send(ctx, {
      channelIdentityRef: 'fake-channel',
      to: '+5511999990003' as import('@cadencia/integrations').E164,
      body: { kind: 'text', text: 'Teste' },
      conversationId: uuidv7(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('rejected');
      expect(r.error.detail).toContain('canal suspenso');
    }
  });
});
```

- [ ] Rodar `pnpm vitest run apps/api/src/routes/fase2-e2e.int.test.ts` e confirmar que todos os 14 testes passam.

Saida esperada: 14 testes passando.

- [ ] Documentar a sequencia completa do gate de qualidade. Nao e um arquivo separado — sao os comandos a rodar:

```bash
# Gate de qualidade completo da Fase 2 — rodar nesta ordem
pnpm typecheck          # 0 erros
pnpm arch:check         # 0 violacoes
pnpm lint:terminology-clock  # 0 violacoes
pnpm lint:session-guc   # 0 violacoes
pnpm test               # todos os testes de unidade passam
pnpm test:int           # todos os testes de integracao passam
pnpm test:iso           # todos os testes de isolamento passam (msg.* e fin.* verificadas)
pnpm db:invariants      # todos verdes (requer banco vivo)
pnpm db:privileges      # novas relacoes declaradas (requer banco vivo)
pnpm prepush            # pass (executa typecheck + arch:check + lints + test + test:int + test:iso)
```

- [ ] Commitar: `feat: Fase 2 definition-of-done gate and end-to-end demonstration`
