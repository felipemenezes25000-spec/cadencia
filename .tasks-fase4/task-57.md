### Task 57: Tela Lotes — lista de lotes por operadora com status visual

**Arquivos**

- Criar `apps/web/src/telas/ConveniosLotes.tsx`
- Criar `apps/web/src/telas/ConveniosLotes.test.tsx`

**Por que**: A tela "Lotes" (`/financeiro/convenios/lotes`) lista lotes por operadora com chip de status colorido (rascunho, enviado, processado, glosado). Acoes por lote: abrir, enviar, cancelar, baixar XML. Expandir mostra as guias do lote com valor e sequencial.

- [ ] Criar o teste `apps/web/src/telas/ConveniosLotes.test.tsx`:

```tsx
// apps/web/src/telas/ConveniosLotes.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  ConveniosLotes,
  type Lote,
  type LotesDados,
} from './ConveniosLotes';

const LOTES: readonly Lote[] = [
  {
    id: 'l1', numero: 'L-2026-001', operadoraNome: 'Unimed',
    registroAns: '123456', status: 'rascunho',
    totalGuias: 5, totalCentavos: 75000,
    criadoEm: '2026-08-05', enviadoEm: null,
    guias: [
      { id: 'g1', numeroGuia: '000001', pacienteNome: 'Maria Souza',
        codigoProcedimento: '10101012', valorCentavos: 15000, sequencial: 1 },
      { id: 'g2', numeroGuia: '000002', pacienteNome: 'Joao Silva',
        codigoProcedimento: '10101012', valorCentavos: 18000, sequencial: 2 },
    ],
  },
  {
    id: 'l2', numero: 'L-2026-002', operadoraNome: 'Bradesco Saude',
    registroAns: '654321', status: 'enviado',
    totalGuias: 3, totalCentavos: 45000,
    criadoEm: '2026-08-03', enviadoEm: '2026-08-04',
    guias: [
      { id: 'g3', numeroGuia: '000003', pacienteNome: 'Ana Costa',
        codigoProcedimento: '20201015', valorCentavos: 15000, sequencial: 1 },
    ],
  },
  {
    id: 'l3', numero: 'L-2026-003', operadoraNome: 'Unimed',
    registroAns: '123456', status: 'processado',
    totalGuias: 8, totalCentavos: 120000,
    criadoEm: '2026-08-01', enviadoEm: '2026-08-02',
    guias: [],
  },
];

const DADOS: LotesDados = { lotes: LOTES };

function montar() {
  const props = {
    carregarDados: vi.fn(async () => DADOS),
    aoEnviar: vi.fn(async (_id: string) => {}),
    aoCancelar: vi.fn(async (_id: string) => {}),
    aoBaixarXml: vi.fn(async (_id: string) => {}),
  };
  render(<ConveniosLotes {...props} />);
  return props;
}

describe('ConveniosLotes', () => {
  it('lista os lotes com numero, operadora e total de guias', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('L-2026-001')).toBeVisible());
    expect(screen.getByText('L-2026-002')).toBeVisible();
    expect(screen.getByText('L-2026-003')).toBeVisible();
  });

  it('exibe chip de status com cores corretas', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Rascunho')).toBeVisible());
    expect(screen.getByText('Enviado')).toBeVisible();
    expect(screen.getByText('Processado')).toBeVisible();
  });

  it('exibe o valor total do lote formatado em reais', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 750,00')).toBeVisible());
    expect(screen.getByText('R$ 450,00')).toBeVisible();
  });

  it('lote rascunho tem botoes Enviar e Cancelar', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('L-2026-001')).toBeVisible());
    const linha = screen.getByText('L-2026-001').closest('li');
    expect(linha).toBeTruthy();
    expect(within(linha!).getByRole('button', { name: /Enviar/i })).toBeVisible();
    expect(within(linha!).getByRole('button', { name: /Cancelar/i })).toBeVisible();
  });

  it('lote enviado tem botao Baixar XML e nao tem Enviar', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('L-2026-002')).toBeVisible());
    const linha = screen.getByText('L-2026-002').closest('li');
    expect(linha).toBeTruthy();
    expect(within(linha!).getByRole('button', { name: /Baixar XML/i })).toBeVisible();
    expect(within(linha!).queryByRole('button', { name: /^Enviar$/i })).not.toBeInTheDocument();
  });

  it('ao clicar Enviar chama aoEnviar com o id do lote', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('L-2026-001')).toBeVisible());
    const linha = screen.getByText('L-2026-001').closest('li');
    await userEvent.click(within(linha!).getByRole('button', { name: /Enviar/i }));
    expect(props.aoEnviar).toHaveBeenCalledWith('l1');
  });

  it('ao clicar Baixar XML chama aoBaixarXml com o id do lote', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('L-2026-002')).toBeVisible());
    const linha = screen.getByText('L-2026-002').closest('li');
    await userEvent.click(within(linha!).getByRole('button', { name: /Baixar XML/i }));
    expect(props.aoBaixarXml).toHaveBeenCalledWith('l2');
  });

  it('expandir lote mostra as guias com sequencial e valor', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('L-2026-001')).toBeVisible());
    const expandir = screen.getAllByRole('button', { name: /Expandir/i })[0]!;
    await userEvent.click(expandir);
    expect(screen.getByText('000001')).toBeVisible();
    expect(screen.getByText('Maria Souza')).toBeVisible();
    expect(screen.getByText('000002')).toBeVisible();
    expect(screen.getByText('Joao Silva')).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <ConveniosLotes
        carregarDados={async () => DADOS}
        aoEnviar={async () => {}}
        aoCancelar={async () => {}}
        aoBaixarXml={async () => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText('L-2026-001')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha porque o modulo nao existe:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosLotes.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './ConveniosLotes'
```

- [ ] Criar o componente `apps/web/src/telas/ConveniosLotes.tsx`:

```tsx
// apps/web/src/telas/ConveniosLotes.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';

// ── Tipos ──────────────────────────────────────────────────────────────────

export type StatusLote = 'rascunho' | 'enviado' | 'processado' | 'glosado';

export interface GuiaDoLote {
  readonly id: string;
  readonly numeroGuia: string;
  readonly pacienteNome: string;
  readonly codigoProcedimento: string;
  readonly valorCentavos: number;
  readonly sequencial: number;
}

export interface Lote {
  readonly id: string;
  readonly numero: string;
  readonly operadoraNome: string;
  readonly registroAns: string;
  readonly status: StatusLote;
  readonly totalGuias: number;
  readonly totalCentavos: number;
  readonly criadoEm: string;
  readonly enviadoEm: string | null;
  readonly guias: readonly GuiaDoLote[];
}

export interface LotesDados {
  readonly lotes: readonly Lote[];
}

export interface ConveniosLotesProps {
  readonly carregarDados: () => Promise<LotesDados>;
  readonly aoEnviar: (loteId: string) => Promise<void>;
  readonly aoCancelar: (loteId: string) => Promise<void>;
  readonly aoBaixarXml: (loteId: string) => Promise<void>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

const STATUS_CHIP: Record<StatusLote, { rotulo: string; glifo: string; cor: string; bg: string }> = {
  rascunho:   { rotulo: 'Rascunho',   glifo: '●', cor: 'var(--text-muted)', bg: 'var(--surface-sunken)' },
  enviado:    { rotulo: 'Enviado',    glifo: '↑', cor: 'var(--accent)',      bg: 'var(--accent-soft)' },
  processado: { rotulo: 'Processado', glifo: '✓', cor: 'var(--ok)',          bg: 'var(--ok-soft)' },
  glosado:    { rotulo: 'Glosado',    glifo: '!', cor: 'var(--danger)',      bg: 'var(--danger-soft)' },
};

// ── Componente ─────────────────────────────────────────────────────────────

export function ConveniosLotes(p: ConveniosLotesProps) {
  const [dados, setDados] = useState<LotesDados | null>(null);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  useEffect(() => {
    void p.carregarDados().then(setDados);
  }, [p]);

  function alternarExpandir(id: string): void {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
        Lotes
      </h2>

      <section aria-label="Lista de lotes">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.lotes.map((lote) => {
            const chip = STATUS_CHIP[lote.status];
            const expandido = expandidos.has(lote.id);

            return (
              <li key={lote.id} style={{ borderBottom: 'var(--border)' }}>
                {/* Cabecalho do lote */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto auto',
                  alignItems: 'center', gap: 'var(--s-4)',
                  padding: 'var(--s-5) var(--s-5)', minHeight: 56,
                }}>
                  {/* Expandir */}
                  <button
                    type="button"
                    onClick={() => alternarExpandir(lote.id)}
                    aria-expanded={expandido}
                    aria-label="Expandir"
                    style={{
                      border: 0, background: 'transparent', cursor: 'pointer',
                      fontSize: 'var(--fs-14)', color: 'var(--text-muted)',
                      width: 24, height: 24, display: 'flex', alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {expandido ? '▾' : '▸'}
                  </button>

                  {/* Info do lote */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                      <span className="num" style={{
                        fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)',
                        fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                      }}>
                        {lote.numero}
                      </span>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)',
                        fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
                        fontWeight: 'var(--fw-medium)', padding: 'var(--s-1) var(--s-4)',
                        borderRadius: 'var(--r-full)',
                        color: chip.cor, background: chip.bg,
                      }}>
                        <span aria-hidden="true">{chip.glifo}</span>{chip.rotulo}
                      </span>
                    </div>
                    <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                                   color: 'var(--text-muted)' }}>
                      {lote.operadoraNome} — {lote.totalGuias} guia(s) — Criado em {lote.criadoEm}
                      {lote.enviadoEm !== null ? ` — Enviado em ${lote.enviadoEm}` : ''}
                    </span>
                  </div>

                  {/* Valor total */}
                  <span className="num" style={{
                    fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {centavosParaReais(lote.totalCentavos)}
                  </span>

                  {/* Acoes */}
                  <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
                    {lote.status === 'rascunho' ? (
                      <>
                        <Botao variante="primario" altura={28}
                          onClick={() => { void p.aoEnviar(lote.id); }}>
                          Enviar
                        </Botao>
                        <Botao variante="fantasma" altura={28}
                          onClick={() => { void p.aoCancelar(lote.id); }}>
                          Cancelar
                        </Botao>
                      </>
                    ) : null}
                    {lote.status === 'enviado' || lote.status === 'processado' ? (
                      <Botao variante="secundario" altura={28}
                        onClick={() => { void p.aoBaixarXml(lote.id); }}>
                        Baixar XML
                      </Botao>
                    ) : null}
                  </div>
                </div>

                {/* Guias expandidas */}
                {expandido && lote.guias.length > 0 ? (
                  <div style={{ padding: '0 var(--s-5) var(--s-5)',
                                paddingInlineStart: 'calc(var(--s-5) + 24px + var(--s-4))' }}>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                                 border: 'var(--border)', borderRadius: 'var(--r-sm)',
                                 overflow: 'hidden', background: 'var(--surface-sunken)' }}>
                      {lote.guias.map((g) => (
                        <li key={g.id} style={{
                          display: 'grid', gridTemplateColumns: 'auto 1fr auto',
                          alignItems: 'center', gap: 'var(--s-4)',
                          padding: 'var(--s-3) var(--s-4)',
                          borderBottom: 'var(--border)', fontSize: 'var(--fs-13)',
                        }}>
                          <span className="num" style={{
                            fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                            color: 'var(--text-muted)', minWidth: '3ch', textAlign: 'right',
                          }}>
                            {g.sequencial}
                          </span>
                          <div>
                            <span className="num" style={{
                              fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                              color: 'var(--text-muted)',
                            }}>
                              {g.numeroGuia}
                            </span>
                            {' '}
                            <span>{g.pacienteNome}</span>
                          </div>
                          <span className="num" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {centavosParaReais(g.valorCentavos)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosLotes.test.tsx 2>&1 | tail -5
# Esperado: Tests  10 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/ConveniosLotes.tsx apps/web/src/telas/ConveniosLotes.test.tsx
git commit -m "feat(web): add ConveniosLotes batch listing screen"
```

---