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
