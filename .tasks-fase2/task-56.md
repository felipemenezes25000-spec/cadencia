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