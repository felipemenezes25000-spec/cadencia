### Task 65: Tipos de dados de desempenho e helpers de formatacao de variacao

**Arquivos**

- Criar `apps/web/src/telas/desempenho/types.ts`
- Criar `apps/web/src/telas/desempenho/format.ts`
- Teste `apps/web/src/telas/desempenho/format.test.ts`

**Por que primeiro:** toda tela de desempenho depende dos tipos de dados e dos helpers de
formatacao de variacao (delta absoluto, delta percentual, frase em linguagem natural). Definir
aqui evita duplicacao e garante que o contrato entre as telas e seus dados de teste seja unico.

- [ ] Criar o arquivo de teste `apps/web/src/telas/desempenho/format.test.ts`:

```ts
// apps/web/src/telas/desempenho/format.test.ts
import { describe, expect, it } from 'vitest';
import {
  formatDelta,
  formatDeltaPct,
  buildVariationPhrase,
  formatPeriodLabel,
} from './format';

describe('formatDelta', () => {
  it('valor positivo recebe sinal de mais', () => {
    expect(formatDelta(1420000)).toBe('+R$ 14.200,00');
  });

  it('valor negativo recebe sinal de menos', () => {
    expect(formatDelta(-1420000)).toBe('-R$ 14.200,00');
  });

  it('valor zero sem sinal', () => {
    expect(formatDelta(0)).toBe('R$ 0,00');
  });
});

describe('formatDeltaPct', () => {
  it('percentual positivo com sinal', () => {
    expect(formatDeltaPct(4)).toBe('+4%');
  });

  it('percentual negativo com sinal', () => {
    expect(formatDeltaPct(-18)).toBe('-18%');
  });

  it('zero sem sinal', () => {
    expect(formatDeltaPct(0)).toBe('0%');
  });

  it('decimal arredondado para uma casa', () => {
    expect(formatDeltaPct(4.56)).toBe('+4,6%');
  });
});

describe('buildVariationPhrase', () => {
  it('receita que caiu gera frase com "caiu"', () => {
    const frase = buildVariationPhrase('receita', -1420000, -18);
    expect(frase).toBe('Receita caiu R$ 14.200 (-18%)');
  });

  it('ticket medio que subiu gera frase com "subiu"', () => {
    const frase = buildVariationPhrase('ticket_medio', 1200, 4);
    expect(frase).toBe('Ticket medio subiu R$ 12 (+4%)');
  });

  it('ocupacao que caiu gera frase com "caiu N pontos"', () => {
    const frase = buildVariationPhrase('ocupacao', -9, -9);
    expect(frase).toBe('Ocupacao caiu 9 pontos');
  });

  it('receita que subiu gera frase com "subiu"', () => {
    const frase = buildVariationPhrase('receita', 500000, 12);
    expect(frase).toBe('Receita subiu R$ 5.000 (+12%)');
  });

  it('variacao zero gera frase com "estavel"', () => {
    const frase = buildVariationPhrase('receita', 0, 0);
    expect(frase).toBe('Receita estavel');
  });
});

describe('formatPeriodLabel', () => {
  it('formata dois meses como "Julho 2026 vs Junho 2026"', () => {
    expect(formatPeriodLabel('2026-07', '2026-06')).toBe('Julho 2026 vs Junho 2026');
  });

  it('formata meses de anos diferentes', () => {
    expect(formatPeriodLabel('2027-01', '2026-12')).toBe('Janeiro 2027 vs Dezembro 2026');
  });
});
```

- [ ] Rodar o teste e confirmar que falha porque os modulos nao existem:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/format.test.ts 2>&1 | head -20
```

Saida esperada: erro de importacao — modulo `./format` nao encontrado.

- [ ] Criar o arquivo de tipos `apps/web/src/telas/desempenho/types.ts`:

```ts
// apps/web/src/telas/desempenho/types.ts

/** Indicador exibido como frase clicavel na pagina de entrada /desempenho. */
export interface VariationIndicator {
  /** Chave semantica do indicador. */
  readonly metric: 'receita' | 'ticket_medio' | 'ocupacao';
  /** Delta absoluto em centavos (receita/ticket) ou pontos percentuais (ocupacao). */
  readonly deltaAbsolute: number;
  /** Delta percentual (ex: -18 para queda de 18%). */
  readonly deltaPercent: number;
}

/** Um fator que compoe o waterfall de decomposicao de um indicador. */
export interface WaterfallFactor {
  readonly factorId: string;
  readonly label: string;
  /** Valor em centavos — positivo contribui para aumento, negativo para queda. */
  readonly valueCents: number;
}

/** Agrupamento de drill-down ao clicar em um fator do waterfall. */
export interface DrillDownGroup {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly valueCents: number;
}

/** Linha de drill-down agrupada por dimensao. */
export interface DrillDownResult {
  readonly dimension: 'profissional' | 'dia_semana' | 'faixa_horario';
  readonly groups: readonly DrillDownGroup[];
  /** Contagem total de itens no drill-down. */
  readonly totalCount: number;
}

/** Acao sugerida ao final do drill-down. */
export interface SuggestedAction {
  readonly actionId: string;
  readonly label: string;
  /** Link para a tela de automacoes com parametros pre-preenchidos. */
  readonly href: string;
}

/** Periodo selecionado no formato YYYY-MM. */
export interface Period {
  readonly current: string;
  readonly previous: string;
}

/** Carimbo de atualizacao dos dados vindos de matview. */
export interface DataFreshness {
  readonly source: 'live' | 'matview';
  /** ISO 8601 do momento do ultimo refresh, presente apenas quando source=matview. */
  readonly refreshedAt: string | null;
}

// ── Explorar ────────────────────────────────────────────────────────────

export type ChartKind = 'bar' | 'line' | 'pie';

export interface ExploreFilter {
  readonly professionalId?: string;
  readonly clinicId?: string;
  readonly categoryId?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly paymentMethod?: string;
  readonly status?: string;
}

export interface ExploreRow {
  readonly key: string;
  readonly label: string;
  readonly valueCents: number;
  readonly count: number;
}

export interface SavedView {
  readonly viewId: string;
  readonly name: string;
  readonly filters: ExploreFilter;
  readonly chartKind: ChartKind;
}

// ── Satisfacao ──────────────────────────────────────────────────────────

export interface NpsSummary {
  readonly score: number;
  readonly promoters: number;
  readonly passives: number;
  readonly detractors: number;
  readonly totalResponses: number;
}

export interface NpsPoint {
  readonly period: string;
  readonly score: number;
}

export interface NpsByProfessional {
  readonly professionalId: string;
  readonly professionalName: string;
  readonly score: number;
  readonly responses: number;
}

// ── Exportar ────────────────────────────────────────────────────────────

export type ExportFormat = 'csv' | 'xlsx';
```

- [ ] Criar o arquivo de helpers `apps/web/src/telas/desempenho/format.ts`:

```ts
// apps/web/src/telas/desempenho/format.ts

const MESES: readonly string[] = [
  'Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const LABELS: Record<string, string> = {
  receita: 'Receita',
  ticket_medio: 'Ticket medio',
  ocupacao: 'Ocupacao',
};

function formatReais(cents: number): string {
  const abs = Math.abs(cents);
  const reais = Math.trunc(abs / 100);
  const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${grouped}`;
}

function formatReaisFull(cents: number): string {
  const abs = Math.abs(cents);
  const reais = Math.trunc(abs / 100);
  const rest = abs % 100;
  const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${grouped},${String(rest).padStart(2, '0')}`;
}

export function formatDelta(cents: number): string {
  if (cents === 0) return formatReaisFull(0);
  const sign = cents > 0 ? '+' : '-';
  return `${sign}${formatReaisFull(Math.abs(cents))}`;
}

export function formatDeltaPct(pct: number): string {
  if (pct === 0) return '0%';
  const sign = pct > 0 ? '+' : '-';
  const abs = Math.abs(pct);
  const formatted = Number.isInteger(abs) ? String(abs) : abs.toFixed(1).replace('.', ',');
  return `${sign}${formatted}%`;
}

export function buildVariationPhrase(
  metric: 'receita' | 'ticket_medio' | 'ocupacao',
  deltaAbsolute: number,
  deltaPercent: number,
): string {
  const label = LABELS[metric] ?? metric;

  if (deltaAbsolute === 0 && deltaPercent === 0) {
    return `${label} estavel`;
  }

  const direction = deltaAbsolute > 0 ? 'subiu' : 'caiu';

  if (metric === 'ocupacao') {
    return `${label} ${direction} ${Math.abs(deltaAbsolute)} pontos`;
  }

  const abs = Math.abs(deltaAbsolute);
  const reaisStr = formatReais(abs);
  const pctStr = formatDeltaPct(deltaPercent);
  return `${label} ${direction} ${reaisStr} (${pctStr})`;
}

export function formatPeriodLabel(current: string, previous: string): string {
  const [cYear, cMonth] = current.split('-').map(Number) as [number, number];
  const [pYear, pMonth] = previous.split('-').map(Number) as [number, number];
  return `${MESES[cMonth - 1]} ${cYear} vs ${MESES[pMonth - 1]} ${pYear}`;
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/format.test.ts
```

Saida esperada: todos os testes passam.

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && git add apps/web/src/telas/desempenho/types.ts apps/web/src/telas/desempenho/format.ts apps/web/src/telas/desempenho/format.test.ts && git commit -m "feat(web): add performance types and variation format helpers"
```

---

### Task 66: Tela Variacoes do periodo (/desempenho) — frases clicaveis e waterfall

**Arquivos**

- Criar `apps/web/src/telas/desempenho/Desempenho.tsx`
- Criar `apps/web/src/telas/desempenho/WaterfallChart.tsx`
- Teste `apps/web/src/telas/desempenho/Desempenho.test.tsx`
- Modificar `apps/web/src/ui/nav.ts`

**Por que:** e a pagina de entrada do Desempenho — §5.5 fluxo (c). A gestora ve frases em
linguagem natural, clica e ve decomposicao waterfall. O seletor de periodo
(mes vs mes anterior por default) fica aqui.

- [ ] Criar o arquivo de teste `apps/web/src/telas/desempenho/Desempenho.test.tsx`:

```tsx
// apps/web/src/telas/desempenho/Desempenho.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Desempenho, type DesempenhoProps } from './Desempenho';
import type {
  VariationIndicator,
  WaterfallFactor,
  DrillDownResult,
  SuggestedAction,
  DataFreshness,
} from './types';

const INDICATORS: VariationIndicator[] = [
  { metric: 'receita', deltaAbsolute: -1420000, deltaPercent: -18 },
  { metric: 'ticket_medio', deltaAbsolute: 1200, deltaPercent: 4 },
  { metric: 'ocupacao', deltaAbsolute: -9, deltaPercent: -9 },
];

const WATERFALL: WaterfallFactor[] = [
  { factorId: 'f1', label: 'Faltas e cancelamentos', valueCents: -980000 },
  { factorId: 'f2', label: 'Mix de convenio', valueCents: -310000 },
  { factorId: 'f3', label: 'Glosas nao recuperadas', valueCents: -240000 },
  { factorId: 'f4', label: 'Ticket medio', valueCents: 110000 },
];

const DRILL_DOWN: DrillDownResult = {
  dimension: 'dia_semana',
  groups: [
    { key: 'seg', label: 'Segunda', count: 22, valueCents: -600000 },
    { key: 'ter', label: 'Terca', count: 8, valueCents: -200000 },
    { key: 'qua', label: 'Quarta', count: 7, valueCents: -180000 },
  ],
  totalCount: 37,
};

const ACTIONS: SuggestedAction[] = [
  { actionId: 'sa1', label: 'Ativar confirmacao 24h antes para segundas de manha',
    href: '/conversas/automacoes?dia=segunda&horario=manha' },
];

const FRESHNESS: DataFreshness = { source: 'matview', refreshedAt: '2026-07-31T14:30:00Z' };

function montar(over: Partial<DesempenhoProps> = {}) {
  const props: DesempenhoProps = {
    period: { current: '2026-07', previous: '2026-06' },
    aoMudarPeriodo: vi.fn(),
    carregarIndicadores: vi.fn(async () => ({ indicators: INDICATORS, freshness: FRESHNESS })),
    carregarWaterfall: vi.fn(async () => WATERFALL),
    carregarDrillDown: vi.fn(async () => ({ result: DRILL_DOWN, actions: ACTIONS })),
    ...over,
  };
  render(<Desempenho {...props} />);
  return props;
}

describe('tela Desempenho — Variacoes do periodo', () => {
  it('exibe o titulo com o periodo selecionado', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1, name: /Desempenho/ })).toBeVisible());
    expect(screen.getByText('Julho 2026 vs Junho 2026')).toBeVisible();
  });

  it('exibe tres frases de variacao em linguagem natural', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText(/Receita caiu R\$ 14\.200/)).toBeVisible();
      expect(screen.getByText(/Ticket medio subiu R\$ 12/)).toBeVisible();
      expect(screen.getByText(/Ocupacao caiu 9 pontos/)).toBeVisible();
    });
  });

  it('cada frase e um botao clicavel', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/Receita caiu/)).toBeVisible());
    const botoes = screen.getAllByRole('button', { name: /Receita|Ticket|Ocupacao/ });
    expect(botoes.length).toBe(3);
  });

  it('clicar numa frase carrega o waterfall de decomposicao', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText(/Receita caiu/)).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Receita caiu/ }));
    await waitFor(() => {
      expect(props.carregarWaterfall).toHaveBeenCalledWith('receita');
      expect(screen.getByText('Faltas e cancelamentos')).toBeVisible();
    });
  });

  it('waterfall exibe barras com valores em reais', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/Receita caiu/)).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Receita caiu/ }));
    await waitFor(() => {
      expect(screen.getByText(/R\$ 9\.800/)).toBeVisible();
      expect(screen.getByText(/R\$ 3\.100/)).toBeVisible();
      expect(screen.getByText(/R\$ 2\.400/)).toBeVisible();
      expect(screen.getByText(/R\$ 1\.100/)).toBeVisible();
    });
  });

  it('clicar num fator do waterfall exibe drill-down agrupado', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText(/Receita caiu/)).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Receita caiu/ }));
    await waitFor(() => expect(screen.getByText('Faltas e cancelamentos')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Faltas e cancelamentos/ }));
    await waitFor(() => {
      expect(props.carregarDrillDown).toHaveBeenCalledWith('receita', 'f1');
      expect(screen.getByText('Segunda')).toBeVisible();
      expect(screen.getByText('22')).toBeVisible();
    });
  });

  it('drill-down mostra acao sugerida com link para automacoes', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/Receita caiu/)).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Receita caiu/ }));
    await waitFor(() => expect(screen.getByText('Faltas e cancelamentos')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Faltas e cancelamentos/ }));
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /Ativar confirmacao/ });
      expect(link).toBeVisible();
      expect(link).toHaveAttribute('href', '/conversas/automacoes?dia=segunda&horario=manha');
    });
  });

  it('exibe carimbo "dados ate HH:MM" quando fonte e matview', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/dados ate/i)).toBeVisible());
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Desempenho
        period={{ current: '2026-07', previous: '2026-06' }}
        aoMudarPeriodo={() => {}}
        carregarIndicadores={async () => ({ indicators: INDICATORS, freshness: FRESHNESS })}
        carregarWaterfall={async () => WATERFALL}
        carregarDrillDown={async () => ({ result: DRILL_DOWN, actions: ACTIONS })}
      />);
    await waitFor(() => expect(screen.getByText(/Receita caiu/)).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/Desempenho.test.tsx 2>&1 | head -20
```

Saida esperada: erro de importacao — modulo `./Desempenho` nao encontrado.

- [ ] Criar o componente WaterfallChart `apps/web/src/telas/desempenho/WaterfallChart.tsx`:

```tsx
// apps/web/src/telas/desempenho/WaterfallChart.tsx
'use client';

import type { WaterfallFactor } from './types';

export interface WaterfallChartProps {
  readonly factors: readonly WaterfallFactor[];
  readonly onFactorClick: (factorId: string) => void;
}

const BAR_HEIGHT = 28;
const GAP = 6;
const LABEL_WIDTH = 220;
const VALUE_WIDTH = 100;

export function WaterfallChart({ factors, onFactorClick }: WaterfallChartProps) {
  const maxAbs = Math.max(...factors.map((f) => Math.abs(f.valueCents)), 1);
  const chartWidth = 300;
  const totalHeight = factors.length * (BAR_HEIGHT + GAP);

  function formatValue(cents: number): string {
    const abs = Math.abs(cents);
    const reais = Math.trunc(abs / 100);
    const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${cents < 0 ? '-' : '+'}R$ ${grouped}`;
  }

  return (
    <div role="table" aria-label="Decomposicao em fatores">
      <div role="rowgroup">
        {factors.map((f) => {
          const barWidth = Math.max((Math.abs(f.valueCents) / maxAbs) * chartWidth, 4);
          const isNegative = f.valueCents < 0;

          return (
            <div key={f.factorId} role="row"
              style={{
                display: 'grid',
                gridTemplateColumns: `${LABEL_WIDTH}px ${chartWidth}px ${VALUE_WIDTH}px`,
                alignItems: 'center',
                gap: 'var(--s-3)',
                marginBottom: `${GAP}px`,
                minHeight: `${BAR_HEIGHT}px`,
              }}>
              <button role="cell"
                type="button"
                onClick={() => onFactorClick(f.factorId)}
                aria-label={`${f.label}`}
                style={{
                  background: 'transparent', border: 0, cursor: 'pointer',
                  textAlign: 'left', padding: 0,
                  fontSize: 'var(--fs-13)', color: 'var(--text)',
                  fontWeight: 'var(--fw-medium)',
                  textDecoration: 'underline',
                  textDecorationColor: 'var(--line)',
                  textUnderlineOffset: '2px',
                }}>
                {f.label}
              </button>
              <div role="cell"
                style={{ position: 'relative', height: `${BAR_HEIGHT}px` }}>
                <div
                  role="img"
                  aria-label={`${f.label}: ${formatValue(f.valueCents)}`}
                  style={{
                    position: 'absolute',
                    left: isNegative ? `${chartWidth / 2 - barWidth}px` : `${chartWidth / 2}px`,
                    top: 0,
                    width: `${barWidth}px`,
                    height: '100%',
                    borderRadius: 'var(--r-sm)',
                    background: isNegative ? 'var(--danger)' : 'var(--ok)',
                    opacity: 0.8,
                  }}
                />
              </div>
              <span role="cell"
                className="num"
                style={{
                  fontSize: 'var(--fs-13)',
                  fontWeight: 'var(--fw-medium)',
                  color: isNegative ? 'var(--danger)' : 'var(--ok)',
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                {formatValue(f.valueCents)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] Criar o componente principal `apps/web/src/telas/desempenho/Desempenho.tsx`:

```tsx
// apps/web/src/telas/desempenho/Desempenho.tsx
'use client';

import { useEffect, useState } from 'react';
import type {
  VariationIndicator,
  WaterfallFactor,
  DrillDownResult,
  SuggestedAction,
  Period,
  DataFreshness,
} from './types';
import { buildVariationPhrase, formatPeriodLabel } from './format';
import { WaterfallChart } from './WaterfallChart';

export interface DesempenhoProps {
  readonly period: Period;
  readonly aoMudarPeriodo: (period: Period) => void;
  readonly carregarIndicadores: () => Promise<{
    indicators: VariationIndicator[];
    freshness: DataFreshness;
  }>;
  readonly carregarWaterfall: (metric: string) => Promise<WaterfallFactor[]>;
  readonly carregarDrillDown: (metric: string, factorId: string) => Promise<{
    result: DrillDownResult;
    actions: SuggestedAction[];
  }>;
}

function formatFreshnessTime(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function Desempenho(p: DesempenhoProps) {
  const [indicators, setIndicators] = useState<VariationIndicator[]>([]);
  const [freshness, setFreshness] = useState<DataFreshness | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [waterfall, setWaterfall] = useState<WaterfallFactor[]>([]);
  const [drillDown, setDrillDown] = useState<DrillDownResult | null>(null);
  const [actions, setActions] = useState<SuggestedAction[]>([]);

  useEffect(() => {
    void p.carregarIndicadores().then((r) => {
      setIndicators(r.indicators);
      setFreshness(r.freshness);
    });
  }, [p]);

  async function onIndicatorClick(metric: string): Promise<void> {
    setSelectedMetric(metric);
    setDrillDown(null);
    setActions([]);
    const factors = await p.carregarWaterfall(metric);
    setWaterfall(factors);
  }

  async function onFactorClick(factorId: string): Promise<void> {
    if (selectedMetric === null) return;
    const { result, actions: suggestedActions } =
      await p.carregarDrillDown(selectedMetric, factorId);
    setDrillDown(result);
    setActions(suggestedActions);
  }

  const periodLabel = formatPeriodLabel(p.period.current, p.period.previous);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)',
                  maxWidth: 960, margin: '0 auto' }}>
      <div>
        <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                     lineHeight: 'var(--lh-tight)', margin: 0 }}>
          Desempenho
        </h1>
        <p style={{ fontSize: 'var(--fs-14)', color: 'var(--text-muted)', margin: `var(--s-2) 0 0` }}>
          {periodLabel}
        </p>
      </div>

      {freshness !== null && freshness.source === 'matview' && freshness.refreshedAt !== null ? (
        <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-faint)',
                    textTransform: 'uppercase', letterSpacing: '.04em', margin: 0 }}>
          dados ate {formatFreshnessTime(freshness.refreshedAt)}
        </p>
      ) : null}

      {/* Frases de variacao */}
      <section aria-label="Variacoes do periodo"
        style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                 background: 'var(--surface)', padding: 'var(--s-6)',
                 display: 'grid', gap: 'var(--s-4)' }}>
        {indicators.map((ind) => {
          const phrase = buildVariationPhrase(ind.metric, ind.deltaAbsolute, ind.deltaPercent);
          const isSelected = selectedMetric === ind.metric;
          return (
            <button key={ind.metric} type="button"
              aria-label={phrase}
              aria-expanded={isSelected}
              onClick={() => { void onIndicatorClick(ind.metric); }}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: isSelected ? 'var(--surface-hover)' : 'transparent',
                border: 0, cursor: 'pointer', padding: `var(--s-4) var(--s-4)`,
                borderRadius: 'var(--r-sm)', textAlign: 'left',
                fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-medium)',
                color: 'var(--text)', width: '100%',
              }}>
              <span>{phrase}</span>
              <span aria-hidden="true" style={{ color: 'var(--text-faint)' }}>›</span>
            </button>
          );
        })}
      </section>

      {/* Waterfall de decomposicao */}
      {selectedMetric !== null && waterfall.length > 0 ? (
        <section aria-label="Decomposicao"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)',
                   overflowX: 'auto' }}>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                       margin: `0 0 var(--s-6)` }}>
            Decomposicao
          </h2>
          <WaterfallChart factors={waterfall} onFactorClick={onFactorClick} />
        </section>
      ) : null}

      {/* Drill-down */}
      {drillDown !== null ? (
        <section aria-label="Detalhamento"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                       margin: `0 0 var(--s-2)` }}>
            Detalhamento
          </h2>
          <p style={{ fontSize: 'var(--fs-13)', color: 'var(--text-muted)',
                      margin: `0 0 var(--s-5)` }}>
            {drillDown.totalCount} atendimentos
          </p>

          <table style={{ width: '100%', borderCollapse: 'collapse',
                          fontSize: 'var(--fs-13)' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: `var(--s-2) var(--s-3)`,
                             borderBottom: 'var(--border)', color: 'var(--text-muted)',
                             fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                             letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                  Grupo
                </th>
                <th style={{ textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                             borderBottom: 'var(--border)', color: 'var(--text-muted)',
                             fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                             letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                  Qtd
                </th>
              </tr>
            </thead>
            <tbody>
              {drillDown.groups.map((g) => (
                <tr key={g.key}>
                  <td style={{ padding: `var(--s-2) var(--s-3)`,
                               borderBottom: 'var(--border)' }}>
                    {g.label}
                  </td>
                  <td className="num" style={{
                    textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                    borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                  }}>
                    {g.count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Acoes sugeridas */}
          {actions.length > 0 ? (
            <div style={{ marginTop: 'var(--s-6)', display: 'grid', gap: 'var(--s-3)' }}>
              {actions.map((a) => (
                <a key={a.actionId} href={a.href}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 'var(--s-3)',
                    fontSize: 'var(--fs-14)', color: 'var(--accent)',
                    fontWeight: 'var(--fw-medium)', textDecoration: 'none',
                  }}>
                  {a.label}
                </a>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Tabela acessivel alternativa ao waterfall */}
      {selectedMetric !== null && waterfall.length > 0 ? (
        <details style={{ fontSize: 'var(--fs-13)', color: 'var(--text-muted)' }}>
          <summary>Tabela acessivel dos fatores</summary>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 'var(--s-3)' }}>
            <caption className="sr-only">Decomposicao por fatores</caption>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: 'var(--s-2)', borderBottom: 'var(--border)' }}>
                  Fator
                </th>
                <th style={{ textAlign: 'right', padding: 'var(--s-2)', borderBottom: 'var(--border)' }}>
                  Valor
                </th>
              </tr>
            </thead>
            <tbody>
              {waterfall.map((f) => (
                <tr key={f.factorId}>
                  <td style={{ padding: 'var(--s-2)', borderBottom: 'var(--border)' }}>
                    {f.label}
                  </td>
                  <td className="num" style={{
                    textAlign: 'right', padding: 'var(--s-2)', borderBottom: 'var(--border)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {f.valueCents < 0 ? '-' : '+'}R$ {Math.trunc(Math.abs(f.valueCents) / 100).toLocaleString('pt-BR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </div>
  );
}
```

- [ ] Atualizar `apps/web/src/ui/nav.ts` para habilitar Desempenho na Fase 3:

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

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/Desempenho.test.tsx
```

Saida esperada: todos os testes passam.

- [ ] Rodar o teste de navegacao existente para garantir que nada quebrou:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/ui/BarraDeNavegacao.test.tsx
```

Saida esperada: passa (Desempenho agora visivel porque FASE_ATUAL = 3).

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && git add apps/web/src/telas/desempenho/Desempenho.tsx apps/web/src/telas/desempenho/Desempenho.test.tsx apps/web/src/telas/desempenho/WaterfallChart.tsx apps/web/src/ui/nav.ts && git commit -m "feat(web): add Desempenho screen with variation phrases and waterfall drill-down"
```

---

### Task 67: Tela Explorar (/desempenho/explorar) — filtros combinaveis, grafico alternavel e visoes salvas

**Arquivos**

- Criar `apps/web/src/telas/desempenho/Explorar.tsx`
- Teste `apps/web/src/telas/desempenho/Explorar.test.tsx`

**Por que:** Explorar e a tela que substitui os 11 relatorios do iClinic (§5.3). Filtros
combinaveis, resultado em tabela + grafico alternavel (bar/line/pie), visoes salvas como
tabs horizontais.

- [ ] Criar o arquivo de teste `apps/web/src/telas/desempenho/Explorar.test.tsx`:

```tsx
// apps/web/src/telas/desempenho/Explorar.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Explorar, type ExplorarProps } from './Explorar';
import type { ExploreRow, SavedView, ExploreFilter, ChartKind, DataFreshness } from './types';

const ROWS: ExploreRow[] = [
  { key: 'r1', label: 'Consulta', valueCents: 1500000, count: 60 },
  { key: 'r2', label: 'Retorno', valueCents: 450000, count: 30 },
  { key: 'r3', label: 'Exame', valueCents: 300000, count: 15 },
];

const VIEWS: SavedView[] = [
  { viewId: 'v1', name: 'Receita por procedimento', filters: { dateFrom: '2026-07-01', dateTo: '2026-07-31' }, chartKind: 'bar' },
  { viewId: 'v2', name: 'Atendimentos por profissional', filters: { dateFrom: '2026-07-01', dateTo: '2026-07-31' }, chartKind: 'line' },
];

const FRESHNESS: DataFreshness = { source: 'matview', refreshedAt: '2026-07-31T16:00:00Z' };

function montar(over: Partial<ExplorarProps> = {}) {
  const props: ExplorarProps = {
    filters: {},
    chartKind: 'bar',
    savedViews: VIEWS,
    aoMudarFiltros: vi.fn(),
    aoMudarGrafico: vi.fn(),
    carregarDados: vi.fn(async () => ({ rows: ROWS, freshness: FRESHNESS })),
    aoSalvarVisao: vi.fn(async () => ({ viewId: 'v3', name: 'Nova visao', filters: {}, chartKind: 'bar' })),
    aoSelecionarVisao: vi.fn(),
    ...over,
  };
  render(<Explorar {...props} />);
  return props;
}

describe('tela Explorar', () => {
  it('exibe o titulo Explorar', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1, name: /Explorar/ })).toBeVisible());
  });

  it('exibe tabs de visoes salvas', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Receita por procedimento' })).toBeVisible();
      expect(screen.getByRole('tab', { name: 'Atendimentos por profissional' })).toBeVisible();
    });
  });

  it('clicar numa tab de visao salva chama callback', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Receita por procedimento' })).toBeVisible());
    await userEvent.click(screen.getByRole('tab', { name: 'Receita por procedimento' }));
    expect(props.aoSelecionarVisao).toHaveBeenCalledWith('v1');
  });

  it('exibe tabela com dados carregados', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Consulta')).toBeVisible();
      expect(screen.getByText('60')).toBeVisible();
    });
  });

  it('exibe os tres botoes de tipo de grafico (bar/line/pie)', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /Barras/ })).toBeVisible();
      expect(screen.getByRole('radio', { name: /Linhas/ })).toBeVisible();
      expect(screen.getByRole('radio', { name: /Pizza/ })).toBeVisible();
    });
  });

  it('clicar no botao de tipo de grafico chama callback', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByRole('radio', { name: /Linhas/ })).toBeVisible());
    await userEvent.click(screen.getByRole('radio', { name: /Linhas/ }));
    expect(props.aoMudarGrafico).toHaveBeenCalledWith('line');
  });

  it('botao Salvar visao esta presente', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Salvar visao/ })).toBeVisible());
  });

  it('exibe carimbo de dados quando fonte e matview', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/dados ate/i)).toBeVisible());
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Explorar
        filters={{}}
        chartKind="bar"
        savedViews={VIEWS}
        aoMudarFiltros={() => {}}
        aoMudarGrafico={() => {}}
        carregarDados={async () => ({ rows: ROWS, freshness: FRESHNESS })}
        aoSalvarVisao={async () => ({ viewId: 'v3', name: 'Nova visao', filters: {}, chartKind: 'bar' })}
        aoSelecionarVisao={() => {}}
      />);
    await waitFor(() => expect(screen.getByText('Consulta')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/Explorar.test.tsx 2>&1 | head -20
```

Saida esperada: erro de importacao — modulo `./Explorar` nao encontrado.

- [ ] Criar o componente `apps/web/src/telas/desempenho/Explorar.tsx`:

```tsx
// apps/web/src/telas/desempenho/Explorar.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../../ui/Botao';
import type {
  ExploreFilter,
  ExploreRow,
  SavedView,
  ChartKind,
  DataFreshness,
} from './types';

export interface ExplorarProps {
  readonly filters: ExploreFilter;
  readonly chartKind: ChartKind;
  readonly savedViews: readonly SavedView[];
  readonly aoMudarFiltros: (filters: ExploreFilter) => void;
  readonly aoMudarGrafico: (kind: ChartKind) => void;
  readonly carregarDados: (filters: ExploreFilter) => Promise<{
    rows: ExploreRow[];
    freshness: DataFreshness;
  }>;
  readonly aoSalvarVisao: (name: string, filters: ExploreFilter, chartKind: ChartKind) =>
    Promise<SavedView>;
  readonly aoSelecionarVisao: (viewId: string) => void;
}

const CHART_LABELS: Record<ChartKind, string> = {
  bar: 'Barras', line: 'Linhas', pie: 'Pizza',
};

function formatCents(cents: number): string {
  const reais = Math.trunc(Math.abs(cents) / 100);
  const rest = Math.abs(cents) % 100;
  const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cents < 0 ? '-' : ''}R$ ${grouped},${String(rest).padStart(2, '0')}`;
}

function SimpleBarChart({ rows }: { readonly rows: readonly ExploreRow[] }) {
  const maxVal = Math.max(...rows.map((r) => r.valueCents), 1);
  return (
    <div role="img" aria-label="Grafico de barras">
      {rows.map((r) => {
        const width = Math.max((r.valueCents / maxVal) * 100, 2);
        return (
          <div key={r.key} style={{ display: 'flex', alignItems: 'center',
                                     gap: 'var(--s-3)', marginBottom: 'var(--s-2)' }}>
            <span style={{ minWidth: 120, fontSize: 'var(--fs-13)', color: 'var(--text)' }}>
              {r.label}
            </span>
            <div style={{ flex: 1, height: 20, background: 'var(--surface-sunken)',
                          borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
              <div style={{ width: `${width}%`, height: '100%',
                            background: 'var(--accent)', borderRadius: 'var(--r-sm)' }} />
            </div>
            <span className="num" style={{ minWidth: 80, textAlign: 'right',
                                            fontSize: 'var(--fs-12)',
                                            fontVariantNumeric: 'tabular-nums' }}>
              {formatCents(r.valueCents)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function Explorar(p: ExplorarProps) {
  const [rows, setRows] = useState<ExploreRow[]>([]);
  const [freshness, setFreshness] = useState<DataFreshness | null>(null);

  useEffect(() => {
    void p.carregarDados(p.filters).then((r) => {
      setRows(r.rows);
      setFreshness(r.freshness);
    });
  }, [p, p.filters]);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)',
                  maxWidth: 1080, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                     lineHeight: 'var(--lh-tight)', margin: 0 }}>
          Explorar
        </h1>
        <Botao variante="secundario" altura={28}
          onClick={() => { void p.aoSalvarVisao('Nova visao', p.filters, p.chartKind); }}>
          Salvar visao
        </Botao>
      </div>

      {freshness !== null && freshness.source === 'matview' && freshness.refreshedAt !== null ? (
        <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-faint)',
                    textTransform: 'uppercase', letterSpacing: '.04em', margin: 0 }}>
          dados ate {new Date(freshness.refreshedAt).toLocaleTimeString('pt-BR',
            { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
        </p>
      ) : null}

      {/* Tabs de visoes salvas */}
      <div role="tablist" aria-label="Visoes salvas"
        style={{ display: 'flex', gap: 'var(--s-1)', overflowX: 'auto',
                 borderBottom: 'var(--border)', paddingBottom: 0 }}>
        {p.savedViews.map((v) => (
          <button key={v.viewId} role="tab" type="button"
            aria-selected={false}
            onClick={() => p.aoSelecionarVisao(v.viewId)}
            style={{
              border: 0, background: 'transparent', cursor: 'pointer',
              padding: `var(--s-3) var(--s-5)`,
              fontSize: 'var(--fs-13)', color: 'var(--text-muted)',
              fontWeight: 'var(--fw-medium)',
              borderBottom: '2px solid transparent',
              whiteSpace: 'nowrap',
            }}>
            {v.name}
          </button>
        ))}
      </div>

      {/* Seletor de tipo de grafico */}
      <div role="radiogroup" aria-label="Tipo de grafico"
        style={{ display: 'flex', gap: 'var(--s-2)' }}>
        {(['bar', 'line', 'pie'] as const).map((kind) => (
          <button key={kind} role="radio" type="button"
            aria-checked={p.chartKind === kind}
            aria-label={CHART_LABELS[kind]}
            onClick={() => p.aoMudarGrafico(kind)}
            style={{
              border: p.chartKind === kind ? '1px solid var(--accent)' : 'var(--border)',
              background: p.chartKind === kind ? 'var(--accent-soft)' : 'var(--surface)',
              borderRadius: 'var(--r-md)', padding: `var(--s-2) var(--s-4)`,
              fontSize: 'var(--fs-12)', color: 'var(--text)', cursor: 'pointer',
              fontWeight: p.chartKind === kind ? 'var(--fw-medium)' : 'var(--fw-regular)',
            }}>
            {CHART_LABELS[kind]}
          </button>
        ))}
      </div>

      {/* Grafico */}
      <section aria-label="Resultado"
        style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                 background: 'var(--surface)', padding: 'var(--s-6)' }}>
        <SimpleBarChart rows={rows} />
      </section>

      {/* Tabela de dados */}
      <section aria-label="Tabela de dados"
        style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse',
                        fontSize: 'var(--fs-13)' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: `var(--s-2) var(--s-3)`,
                           borderBottom: 'var(--border)', color: 'var(--text-muted)',
                           fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                           letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                Item
              </th>
              <th style={{ textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                           borderBottom: 'var(--border)', color: 'var(--text-muted)',
                           fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                           letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                Qtd
              </th>
              <th style={{ textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                           borderBottom: 'var(--border)', color: 'var(--text-muted)',
                           fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                           letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                Valor
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ padding: `var(--s-2) var(--s-3)`,
                             borderBottom: 'var(--border)' }}>
                  {r.label}
                </td>
                <td className="num" style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                }}>
                  {r.count}
                </td>
                <td className="num" style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                }}>
                  {formatCents(r.valueCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/Explorar.test.tsx
```

Saida esperada: todos os testes passam.

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && git add apps/web/src/telas/desempenho/Explorar.tsx apps/web/src/telas/desempenho/Explorar.test.tsx && git commit -m "feat(web): add Explorar screen with combinable filters, chart toggle and saved views"
```

---

### Task 68: Tela Atendimentos (/desempenho/atendimentos) — visao pre-filtrada

**Arquivos**

- Criar `apps/web/src/telas/desempenho/Atendimentos.tsx`
- Teste `apps/web/src/telas/desempenho/Atendimentos.test.tsx`

**Por que:** Atendimentos e uma visao pre-filtrada de Explorar, focada em atendimentos
realizados. Reusa os tipos de dados ja definidos na Task 65 e exibe dados com
carimbo de frescor.

- [ ] Criar o arquivo de teste `apps/web/src/telas/desempenho/Atendimentos.test.tsx`:

```tsx
// apps/web/src/telas/desempenho/Atendimentos.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Atendimentos, type AtendimentosProps } from './Atendimentos';
import type { DataFreshness } from './types';

interface AtendimentoRow {
  readonly key: string;
  readonly professionalName: string;
  readonly procedureName: string;
  readonly count: number;
  readonly valueCents: number;
  readonly avgDurationMin: number;
}

const ROWS: AtendimentoRow[] = [
  { key: 'a1', professionalName: 'Dr. Alceu', procedureName: 'Consulta',
    count: 45, valueCents: 1125000, avgDurationMin: 25 },
  { key: 'a2', professionalName: 'Dra. Beatriz', procedureName: 'Retorno',
    count: 22, valueCents: 330000, avgDurationMin: 15 },
  { key: 'a3', professionalName: 'Dr. Alceu', procedureName: 'Exame',
    count: 10, valueCents: 200000, avgDurationMin: 30 },
];

const FRESHNESS: DataFreshness = { source: 'matview', refreshedAt: '2026-07-31T14:30:00Z' };

function montar(over: Partial<AtendimentosProps> = {}) {
  const props: AtendimentosProps = {
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31',
    carregarDados: vi.fn(async () => ({ rows: ROWS, freshness: FRESHNESS,
      totals: { count: 77, valueCents: 1655000 } })),
    ...over,
  };
  render(<Atendimentos {...props} />);
  return props;
}

describe('tela Atendimentos (Desempenho)', () => {
  it('exibe o titulo Atendimentos', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1, name: /Atendimentos/ })).toBeVisible());
  });

  it('exibe tabela com profissional, procedimento, quantidade e valor', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Dr. Alceu')).toBeVisible();
      expect(screen.getByText('Consulta')).toBeVisible();
      expect(screen.getByText('45')).toBeVisible();
    });
  });

  it('exibe totais no rodape da tabela', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('77')).toBeVisible();
    });
  });

  it('exibe a duracao media em minutos', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('25 min')).toBeVisible();
      expect(screen.getByText('15 min')).toBeVisible();
    });
  });

  it('exibe carimbo de frescor dos dados', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/dados ate/i)).toBeVisible());
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Atendimentos
        dateFrom="2026-07-01"
        dateTo="2026-07-31"
        carregarDados={async () => ({ rows: ROWS, freshness: FRESHNESS,
          totals: { count: 77, valueCents: 1655000 } })}
      />);
    await waitFor(() => expect(screen.getByText('Dr. Alceu')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/Atendimentos.test.tsx 2>&1 | head -20
```

Saida esperada: erro de importacao — modulo `./Atendimentos` nao encontrado.

- [ ] Criar o componente `apps/web/src/telas/desempenho/Atendimentos.tsx`:

```tsx
// apps/web/src/telas/desempenho/Atendimentos.tsx
'use client';

import { useEffect, useState } from 'react';
import type { DataFreshness } from './types';

interface AtendimentoRow {
  readonly key: string;
  readonly professionalName: string;
  readonly procedureName: string;
  readonly count: number;
  readonly valueCents: number;
  readonly avgDurationMin: number;
}

interface AtendimentoTotals {
  readonly count: number;
  readonly valueCents: number;
}

export interface AtendimentosProps {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly carregarDados: () => Promise<{
    rows: AtendimentoRow[];
    freshness: DataFreshness;
    totals: AtendimentoTotals;
  }>;
}

function formatCents(cents: number): string {
  const reais = Math.trunc(Math.abs(cents) / 100);
  const rest = Math.abs(cents) % 100;
  const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cents < 0 ? '-' : ''}R$ ${grouped},${String(rest).padStart(2, '0')}`;
}

export function Atendimentos(p: AtendimentosProps) {
  const [rows, setRows] = useState<AtendimentoRow[]>([]);
  const [totals, setTotals] = useState<AtendimentoTotals | null>(null);
  const [freshness, setFreshness] = useState<DataFreshness | null>(null);

  useEffect(() => {
    void p.carregarDados().then((r) => {
      setRows(r.rows);
      setTotals(r.totals);
      setFreshness(r.freshness);
    });
  }, [p]);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)',
                  maxWidth: 1080, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Atendimentos
      </h1>

      {freshness !== null && freshness.source === 'matview' && freshness.refreshedAt !== null ? (
        <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-faint)',
                    textTransform: 'uppercase', letterSpacing: '.04em', margin: 0 }}>
          dados ate {new Date(freshness.refreshedAt).toLocaleTimeString('pt-BR',
            { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
        </p>
      ) : null}

      <section aria-label="Tabela de atendimentos" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse',
                        fontSize: 'var(--fs-13)' }}>
          <thead>
            <tr>
              {['Profissional', 'Procedimento'].map((h) => (
                <th key={h} style={{
                  textAlign: 'left', padding: `var(--s-2) var(--s-3)`,
                  borderBottom: 'var(--border)', color: 'var(--text-muted)',
                  fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                  letterSpacing: '.04em', fontWeight: 'var(--fw-medium)',
                }}>{h}</th>
              ))}
              {['Qtd', 'Valor', 'Duracao media'].map((h) => (
                <th key={h} style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  borderBottom: 'var(--border)', color: 'var(--text-muted)',
                  fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                  letterSpacing: '.04em', fontWeight: 'var(--fw-medium)',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ padding: `var(--s-2) var(--s-3)`, borderBottom: 'var(--border)' }}>
                  {r.professionalName}
                </td>
                <td style={{ padding: `var(--s-2) var(--s-3)`, borderBottom: 'var(--border)' }}>
                  {r.procedureName}
                </td>
                <td className="num" style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                }}>{r.count}</td>
                <td className="num" style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                }}>{formatCents(r.valueCents)}</td>
                <td className="num" style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                }}>{r.avgDurationMin} min</td>
              </tr>
            ))}
          </tbody>
          {totals !== null ? (
            <tfoot>
              <tr>
                <td colSpan={2} style={{
                  padding: `var(--s-2) var(--s-3)`, fontWeight: 'var(--fw-semibold)',
                  borderTop: '2px solid var(--line-strong)',
                }}>Total</td>
                <td className="num" style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  fontWeight: 'var(--fw-semibold)', fontVariantNumeric: 'tabular-nums',
                  borderTop: '2px solid var(--line-strong)',
                }}>{totals.count}</td>
                <td className="num" style={{
                  textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                  fontWeight: 'var(--fw-semibold)', fontVariantNumeric: 'tabular-nums',
                  borderTop: '2px solid var(--line-strong)',
                }}>{formatCents(totals.valueCents)}</td>
                <td style={{ borderTop: '2px solid var(--line-strong)' }} />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </section>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/Atendimentos.test.tsx
```

Saida esperada: todos os testes passam.

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && git add apps/web/src/telas/desempenho/Atendimentos.tsx apps/web/src/telas/desempenho/Atendimentos.test.tsx && git commit -m "feat(web): add Atendimentos pre-filtered view in Desempenho"
```

---

### Task 69: Tela Satisfacao (/desempenho/satisfacao) — NPS do periodo, evolutivo e por profissional

**Arquivos**

- Criar `apps/web/src/telas/desempenho/Satisfacao.tsx`
- Teste `apps/web/src/telas/desempenho/Satisfacao.test.tsx`

**Por que:** Satisfacao exibe o NPS do periodo, grafico evolutivo e ranking por profissional.
Usa os tipos NpsSummary, NpsPoint e NpsByProfessional definidos na Task 65.

- [ ] Criar o arquivo de teste `apps/web/src/telas/desempenho/Satisfacao.test.tsx`:

```tsx
// apps/web/src/telas/desempenho/Satisfacao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Satisfacao, type SatisfacaoProps } from './Satisfacao';
import type { NpsSummary, NpsPoint, NpsByProfessional, DataFreshness } from './types';

const SUMMARY: NpsSummary = {
  score: 72,
  promoters: 45,
  passives: 20,
  detractors: 8,
  totalResponses: 73,
};

const EVOLUTION: NpsPoint[] = [
  { period: '2026-04', score: 65 },
  { period: '2026-05', score: 68 },
  { period: '2026-06', score: 70 },
  { period: '2026-07', score: 72 },
];

const BY_PROFESSIONAL: NpsByProfessional[] = [
  { professionalId: 'pr1', professionalName: 'Dr. Alceu', score: 85, responses: 30 },
  { professionalId: 'pr2', professionalName: 'Dra. Beatriz', score: 62, responses: 25 },
  { professionalId: 'pr3', professionalName: 'Dr. Carlos', score: 58, responses: 18 },
];

const FRESHNESS: DataFreshness = { source: 'matview', refreshedAt: '2026-07-31T14:30:00Z' };

function montar(over: Partial<SatisfacaoProps> = {}) {
  const props: SatisfacaoProps = {
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31',
    carregarDados: vi.fn(async () => ({
      summary: SUMMARY, evolution: EVOLUTION,
      byProfessional: BY_PROFESSIONAL, freshness: FRESHNESS,
    })),
    ...over,
  };
  render(<Satisfacao {...props} />);
  return props;
}

describe('tela Satisfacao (Desempenho)', () => {
  it('exibe o titulo Satisfacao', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1, name: /Satisfacao/ })).toBeVisible());
  });

  it('exibe o score NPS em destaque', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('72')).toBeVisible());
  });

  it('exibe a distribuicao promotores/neutros/detratores', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText(/45/)).toBeVisible();
      expect(screen.getByText(/Promotores/)).toBeVisible();
      expect(screen.getByText(/20/)).toBeVisible();
      expect(screen.getByText(/Neutros/)).toBeVisible();
      expect(screen.getByText(/8/)).toBeVisible();
      expect(screen.getByText(/Detratores/)).toBeVisible();
    });
  });

  it('exibe o total de respostas', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/73 respostas/)).toBeVisible());
  });

  it('exibe grafico evolutivo com periodos', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('img', { name: /NPS evolutivo/ })).toBeVisible());
  });

  it('exibe ranking por profissional', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Dr. Alceu')).toBeVisible();
      expect(screen.getByText('85')).toBeVisible();
      expect(screen.getByText('Dra. Beatriz')).toBeVisible();
      expect(screen.getByText('62')).toBeVisible();
    });
  });

  it('exibe carimbo de frescor dos dados', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/dados ate/i)).toBeVisible());
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Satisfacao
        dateFrom="2026-07-01"
        dateTo="2026-07-31"
        carregarDados={async () => ({
          summary: SUMMARY, evolution: EVOLUTION,
          byProfessional: BY_PROFESSIONAL, freshness: FRESHNESS,
        })}
      />);
    await waitFor(() => expect(screen.getByText('72')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/Satisfacao.test.tsx 2>&1 | head -20
```

Saida esperada: erro de importacao — modulo `./Satisfacao` nao encontrado.

- [ ] Criar o componente `apps/web/src/telas/desempenho/Satisfacao.tsx`:

```tsx
// apps/web/src/telas/desempenho/Satisfacao.tsx
'use client';

import { useEffect, useState } from 'react';
import type { NpsSummary, NpsPoint, NpsByProfessional, DataFreshness } from './types';

export interface SatisfacaoProps {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly carregarDados: () => Promise<{
    summary: NpsSummary;
    evolution: NpsPoint[];
    byProfessional: NpsByProfessional[];
    freshness: DataFreshness;
  }>;
}

const MESES_CURTO: readonly string[] = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

function npsColor(score: number): string {
  if (score >= 75) return 'var(--ok)';
  if (score >= 50) return 'var(--accent)';
  if (score >= 0) return 'var(--warn)';
  return 'var(--danger)';
}

function NpsEvolutionChart({ points }: { readonly points: readonly NpsPoint[] }) {
  if (points.length === 0) return null;

  const width = 400;
  const height = 120;
  const padding = 30;
  const chartW = width - padding * 2;
  const chartH = height - padding * 2;
  const minScore = Math.min(...points.map((p) => p.score), 0);
  const maxScore = Math.max(...points.map((p) => p.score), 100);
  const range = maxScore - minScore || 1;

  const pathPoints = points.map((pt, i) => {
    const x = padding + (i / Math.max(points.length - 1, 1)) * chartW;
    const y = padding + chartH - ((pt.score - minScore) / range) * chartH;
    return `${x},${y}`;
  });

  const pathD = pathPoints.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt}`).join(' ');

  return (
    <svg
      role="img" aria-label="NPS evolutivo"
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', maxWidth: `${width}px`, height: `${height}px` }}
    >
      <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {points.map((pt, i) => {
        const x = padding + (i / Math.max(points.length - 1, 1)) * chartW;
        const y = padding + chartH - ((pt.score - minScore) / range) * chartH;
        const [, monthStr] = pt.period.split('-');
        const monthIdx = Number(monthStr) - 1;
        return (
          <g key={pt.period}>
            <circle cx={x} cy={y} r={3} fill="var(--accent)" />
            <text x={x} y={height - 4} textAnchor="middle"
              fontSize="10" fill="var(--text-muted)">
              {MESES_CURTO[monthIdx]}
            </text>
            <text x={x} y={y - 8} textAnchor="middle"
              fontSize="10" fill="var(--text)" fontWeight="500">
              {pt.score}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Satisfacao(p: SatisfacaoProps) {
  const [summary, setSummary] = useState<NpsSummary | null>(null);
  const [evolution, setEvolution] = useState<NpsPoint[]>([]);
  const [byProf, setByProf] = useState<NpsByProfessional[]>([]);
  const [freshness, setFreshness] = useState<DataFreshness | null>(null);

  useEffect(() => {
    void p.carregarDados().then((r) => {
      setSummary(r.summary);
      setEvolution(r.evolution);
      setByProf(r.byProfessional);
      setFreshness(r.freshness);
    });
  }, [p]);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)',
                  maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Satisfacao
      </h1>

      {freshness !== null && freshness.source === 'matview' && freshness.refreshedAt !== null ? (
        <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-faint)',
                    textTransform: 'uppercase', letterSpacing: '.04em', margin: 0 }}>
          dados ate {new Date(freshness.refreshedAt).toLocaleTimeString('pt-BR',
            { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
        </p>
      ) : null}

      {/* NPS em destaque */}
      {summary !== null ? (
        <section aria-label="NPS do periodo"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)',
                   display: 'grid', gap: 'var(--s-5)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s-4)' }}>
            <span className="num" style={{
              fontSize: 'var(--fs-28)', fontWeight: 'var(--fw-semibold)',
              color: npsColor(summary.score),
              fontVariantNumeric: 'tabular-nums',
            }}>
              {summary.score}
            </span>
            <span style={{ fontSize: 'var(--fs-14)', color: 'var(--text-muted)' }}>
              NPS — {summary.totalResponses} respostas
            </span>
          </div>

          <div style={{ display: 'flex', gap: 'var(--s-8)' }}>
            <div>
              <span className="num" style={{ fontSize: 'var(--fs-18)',
                fontWeight: 'var(--fw-semibold)', color: 'var(--ok)' }}>
                {summary.promoters}
              </span>
              <span style={{ display: 'block', fontSize: 'var(--fs-11)',
                color: 'var(--text-muted)', textTransform: 'uppercase',
                letterSpacing: '.04em' }}>
                Promotores
              </span>
            </div>
            <div>
              <span className="num" style={{ fontSize: 'var(--fs-18)',
                fontWeight: 'var(--fw-semibold)', color: 'var(--text-muted)' }}>
                {summary.passives}
              </span>
              <span style={{ display: 'block', fontSize: 'var(--fs-11)',
                color: 'var(--text-muted)', textTransform: 'uppercase',
                letterSpacing: '.04em' }}>
                Neutros
              </span>
            </div>
            <div>
              <span className="num" style={{ fontSize: 'var(--fs-18)',
                fontWeight: 'var(--fw-semibold)', color: 'var(--danger)' }}>
                {summary.detractors}
              </span>
              <span style={{ display: 'block', fontSize: 'var(--fs-11)',
                color: 'var(--text-muted)', textTransform: 'uppercase',
                letterSpacing: '.04em' }}>
                Detratores
              </span>
            </div>
          </div>
        </section>
      ) : null}

      {/* Grafico evolutivo */}
      {evolution.length > 0 ? (
        <section aria-label="Evolucao do NPS"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                       margin: `0 0 var(--s-4)` }}>
            Evolutivo
          </h2>
          <div style={{ overflowX: 'auto' }}>
            <NpsEvolutionChart points={evolution} />
          </div>

          {/* Tabela acessivel alternativa */}
          <details style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                            marginTop: 'var(--s-3)' }}>
            <summary>Tabela acessivel do evolutivo</summary>
            <table style={{ width: '100%', borderCollapse: 'collapse',
                            marginTop: 'var(--s-2)' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 'var(--s-1)',
                               borderBottom: 'var(--border)' }}>Periodo</th>
                  <th style={{ textAlign: 'right', padding: 'var(--s-1)',
                               borderBottom: 'var(--border)' }}>NPS</th>
                </tr>
              </thead>
              <tbody>
                {evolution.map((pt) => (
                  <tr key={pt.period}>
                    <td style={{ padding: 'var(--s-1)', borderBottom: 'var(--border)' }}>
                      {pt.period}
                    </td>
                    <td className="num" style={{
                      textAlign: 'right', padding: 'var(--s-1)',
                      borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                    }}>
                      {pt.score}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
      ) : null}

      {/* Ranking por profissional */}
      {byProf.length > 0 ? (
        <section aria-label="NPS por profissional"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                       margin: `0 0 var(--s-4)` }}>
            Por profissional
          </h2>
          <table style={{ width: '100%', borderCollapse: 'collapse',
                          fontSize: 'var(--fs-13)' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: `var(--s-2) var(--s-3)`,
                             borderBottom: 'var(--border)', color: 'var(--text-muted)',
                             fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                             letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                  Profissional
                </th>
                <th style={{ textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                             borderBottom: 'var(--border)', color: 'var(--text-muted)',
                             fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                             letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                  NPS
                </th>
                <th style={{ textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                             borderBottom: 'var(--border)', color: 'var(--text-muted)',
                             fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                             letterSpacing: '.04em', fontWeight: 'var(--fw-medium)' }}>
                  Respostas
                </th>
              </tr>
            </thead>
            <tbody>
              {byProf.map((prof) => (
                <tr key={prof.professionalId}>
                  <td style={{ padding: `var(--s-2) var(--s-3)`, borderBottom: 'var(--border)' }}>
                    {prof.professionalName}
                  </td>
                  <td className="num" style={{
                    textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                    borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                    color: npsColor(prof.score), fontWeight: 'var(--fw-medium)',
                  }}>
                    {prof.score}
                  </td>
                  <td className="num" style={{
                    textAlign: 'right', padding: `var(--s-2) var(--s-3)`,
                    borderBottom: 'var(--border)', fontVariantNumeric: 'tabular-nums',
                  }}>
                    {prof.responses}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/Satisfacao.test.tsx
```

Saida esperada: todos os testes passam.

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && git add apps/web/src/telas/desempenho/Satisfacao.tsx apps/web/src/telas/desempenho/Satisfacao.test.tsx && git commit -m "feat(web): add Satisfacao screen with NPS score, evolution chart and professional ranking"
```

---

### Task 70: Tela Exportar (/desempenho/exportar) — selecionar visao, formato e periodo

**Arquivos**

- Criar `apps/web/src/telas/desempenho/Exportar.tsx`
- Teste `apps/web/src/telas/desempenho/Exportar.test.tsx`

**Por que:** Exportar permite baixar os dados de qualquer visao salva em CSV ou XLSX,
com seletor de periodo. Exibe o carimbo de frescor e desabilita o botao durante o download.

- [ ] Criar o arquivo de teste `apps/web/src/telas/desempenho/Exportar.test.tsx`:

```tsx
// apps/web/src/telas/desempenho/Exportar.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Exportar, type ExportarProps } from './Exportar';
import type { SavedView, ExportFormat, DataFreshness } from './types';

const VIEWS: SavedView[] = [
  { viewId: 'v1', name: 'Receita por procedimento',
    filters: { dateFrom: '2026-07-01', dateTo: '2026-07-31' }, chartKind: 'bar' },
  { viewId: 'v2', name: 'Atendimentos por profissional',
    filters: { dateFrom: '2026-07-01', dateTo: '2026-07-31' }, chartKind: 'line' },
];

const FRESHNESS: DataFreshness = { source: 'matview', refreshedAt: '2026-07-31T14:30:00Z' };

function montar(over: Partial<ExportarProps> = {}) {
  const props: ExportarProps = {
    savedViews: VIEWS,
    freshness: FRESHNESS,
    aoExportar: vi.fn(async () => {}),
    ...over,
  };
  render(<Exportar {...props} />);
  return props;
}

describe('tela Exportar (Desempenho)', () => {
  it('exibe o titulo Exportar', () => {
    montar();
    expect(screen.getByRole('heading', { level: 1, name: /Exportar/ })).toBeVisible();
  });

  it('lista as visoes salvas para selecao', () => {
    montar();
    expect(screen.getByRole('radio', { name: 'Receita por procedimento' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Atendimentos por profissional' })).toBeVisible();
  });

  it('exibe seletor de formato CSV e XLSX', () => {
    montar();
    expect(screen.getByRole('radio', { name: 'CSV' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'XLSX' })).toBeVisible();
  });

  it('exibe campos de data de inicio e fim', () => {
    montar();
    expect(screen.getByLabelText(/De/)).toBeVisible();
    expect(screen.getByLabelText(/Ate/)).toBeVisible();
  });

  it('botao exportar chama callback com visao, formato e periodo', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('radio', { name: 'Receita por procedimento' }));
    await userEvent.click(screen.getByRole('radio', { name: 'CSV' }));
    await userEvent.click(screen.getByRole('button', { name: /Exportar/ }));
    expect(props.aoExportar).toHaveBeenCalledWith(
      expect.objectContaining({ viewId: 'v1', format: 'csv' }));
  });

  it('botao fica desabilitado sem visao selecionada', () => {
    montar();
    expect(screen.getByRole('button', { name: /Exportar/ })).toBeDisabled();
  });

  it('exibe carimbo de frescor dos dados', () => {
    montar();
    expect(screen.getByText(/dados ate/i)).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Exportar
        savedViews={VIEWS}
        freshness={FRESHNESS}
        aoExportar={async () => {}}
      />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/Exportar.test.tsx 2>&1 | head -20
```

Saida esperada: erro de importacao — modulo `./Exportar` nao encontrado.

- [ ] Criar o componente `apps/web/src/telas/desempenho/Exportar.tsx`:

```tsx
// apps/web/src/telas/desempenho/Exportar.tsx
'use client';

import { useState } from 'react';
import { Botao } from '../../ui/Botao';
import type { SavedView, ExportFormat, DataFreshness } from './types';

export interface ExportRequest {
  readonly viewId: string;
  readonly format: ExportFormat;
  readonly dateFrom: string;
  readonly dateTo: string;
}

export interface ExportarProps {
  readonly savedViews: readonly SavedView[];
  readonly freshness: DataFreshness;
  readonly aoExportar: (request: ExportRequest) => Promise<void>;
}

export function Exportar(p: ExportarProps) {
  const [selectedView, setSelectedView] = useState<string | null>(null);
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [exporting, setExporting] = useState(false);

  async function handleExport(): Promise<void> {
    if (selectedView === null) return;
    setExporting(true);
    try {
      await p.aoExportar({ viewId: selectedView, format, dateFrom, dateTo });
    } finally {
      setExporting(false);
    }
  }

  const canExport = selectedView !== null && !exporting;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)',
                  maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Exportar
      </h1>

      {p.freshness.source === 'matview' && p.freshness.refreshedAt !== null ? (
        <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-faint)',
                    textTransform: 'uppercase', letterSpacing: '.04em', margin: 0 }}>
          dados ate {new Date(p.freshness.refreshedAt).toLocaleTimeString('pt-BR',
            { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
        </p>
      ) : null}

      {/* Selecao de visao */}
      <fieldset style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                         padding: 'var(--s-6)', background: 'var(--surface)' }}>
        <legend style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                         padding: `0 var(--s-2)` }}>
          Visao
        </legend>
        <div role="radiogroup" aria-label="Selecionar visao"
          style={{ display: 'grid', gap: 'var(--s-3)', marginTop: 'var(--s-3)' }}>
          {p.savedViews.map((v) => (
            <label key={v.viewId}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)',
                       fontSize: 'var(--fs-14)', cursor: 'pointer',
                       padding: `var(--s-2) 0` }}>
              <input type="radio" name="export-view" value={v.viewId}
                aria-label={v.name}
                checked={selectedView === v.viewId}
                onChange={() => setSelectedView(v.viewId)}
                style={{ accentColor: 'var(--accent)' }}
              />
              {v.name}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Selecao de formato */}
      <fieldset style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                         padding: 'var(--s-6)', background: 'var(--surface)' }}>
        <legend style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                         padding: `0 var(--s-2)` }}>
          Formato
        </legend>
        <div role="radiogroup" aria-label="Selecionar formato"
          style={{ display: 'flex', gap: 'var(--s-6)', marginTop: 'var(--s-3)' }}>
          {(['csv', 'xlsx'] as const).map((f) => (
            <label key={f}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)',
                       fontSize: 'var(--fs-14)', cursor: 'pointer' }}>
              <input type="radio" name="export-format" value={f}
                aria-label={f.toUpperCase()}
                checked={format === f}
                onChange={() => setFormat(f)}
                style={{ accentColor: 'var(--accent)' }}
              />
              {f.toUpperCase()}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Periodo */}
      <fieldset style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                         padding: 'var(--s-6)', background: 'var(--surface)' }}>
        <legend style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                         padding: `0 var(--s-2)` }}>
          Periodo
        </legend>
        <div style={{ display: 'flex', gap: 'var(--s-6)', marginTop: 'var(--s-3)' }}>
          <div>
            <label htmlFor="export-date-from"
              style={{ display: 'block', fontSize: 'var(--fs-12)',
                       color: 'var(--text-muted)', marginBottom: 'var(--s-1)' }}>
              De
            </label>
            <input id="export-date-from" type="date" value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{
                border: 'var(--border)', borderRadius: 'var(--r-md)',
                padding: `var(--s-2) var(--s-3)`, fontSize: 'var(--fs-14)',
                background: 'var(--surface)', color: 'var(--text)',
              }}
            />
          </div>
          <div>
            <label htmlFor="export-date-to"
              style={{ display: 'block', fontSize: 'var(--fs-12)',
                       color: 'var(--text-muted)', marginBottom: 'var(--s-1)' }}>
              Ate
            </label>
            <input id="export-date-to" type="date" value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{
                border: 'var(--border)', borderRadius: 'var(--r-md)',
                padding: `var(--s-2) var(--s-3)`, fontSize: 'var(--fs-14)',
                background: 'var(--surface)', color: 'var(--text)',
              }}
            />
          </div>
        </div>
      </fieldset>

      <Botao variante="primario" altura={40}
        disabled={!canExport}
        carregando={exporting}
        onClick={() => { void handleExport(); }}>
        Exportar
      </Botao>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/Exportar.test.tsx
```

Saida esperada: todos os testes passam.

- [ ] Rodar todos os testes do bloco de desempenho de uma vez para garantir integridade:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && npx vitest run apps/web/src/telas/desempenho/
```

Saida esperada: todos os testes das Tasks 65-70 passam.

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && git add apps/web/src/telas/desempenho/Exportar.tsx apps/web/src/telas/desempenho/Exportar.test.tsx && git commit -m "feat(web): add Exportar screen with view, format and period selection"
```
