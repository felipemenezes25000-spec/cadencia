// apps/web/src/ui/GraficoExplorar.tsx
'use client';

import type { ChartKind } from '@cadencia/reports';

export interface DadoGrafico {
  readonly label: string;
  readonly value: number;
}

export interface GraficoExplorarProps {
  readonly tipo: ChartKind;
  readonly dados: readonly DadoGrafico[];
  readonly largura: number;
  readonly altura: number;
}

const MARGEM = { top: 20, right: 20, bottom: 40, left: 50 };

const CORES = [
  'var(--accent)', 'var(--ok)', 'var(--warn)', 'var(--danger)',
  'var(--ai)', 'var(--text-muted)',
];

function GraficoBarra({ dados, largura, altura }: Omit<GraficoExplorarProps, 'tipo'>) {
  const innerW = largura - MARGEM.left - MARGEM.right;
  const innerH = altura - MARGEM.top - MARGEM.bottom;
  const maxVal = Math.max(...dados.map((d) => d.value), 1);
  const barW = Math.max(innerW / dados.length - 4, 8);

  return (
    <g transform={`translate(${MARGEM.left},${MARGEM.top})`}>
      {dados.map((d, i) => {
        const barH = (d.value / maxVal) * innerH;
        const x = (innerW / dados.length) * i + 2;
        const y = innerH - barH;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={barW} height={barH}
              rx={3} fill="var(--accent)"
              role="img" aria-label={`${d.label}: ${d.value}`} />
            <text x={x + barW / 2} y={innerH + 16}
              textAnchor="middle" fontSize="10" fill="var(--text-muted)">
              {d.label.length > 6 ? d.label.slice(0, 6) : d.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function GraficoLinha({ dados, largura, altura }: Omit<GraficoExplorarProps, 'tipo'>) {
  const innerW = largura - MARGEM.left - MARGEM.right;
  const innerH = altura - MARGEM.top - MARGEM.bottom;
  const maxVal = Math.max(...dados.map((d) => d.value), 1);

  const pontos = dados.map((d, i) => {
    const x = (innerW / Math.max(dados.length - 1, 1)) * i;
    const y = innerH - (d.value / maxVal) * innerH;
    return { x, y, label: d.label, value: d.value };
  });

  const pathD = pontos.map((pt, i) =>
    `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');

  return (
    <g transform={`translate(${MARGEM.left},${MARGEM.top})`}>
      <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {pontos.map((pt) => (
        <circle key={pt.label} cx={pt.x} cy={pt.y} r={3}
          fill="var(--accent)"
          role="img" aria-label={`${pt.label}: ${pt.value}`} />
      ))}
    </g>
  );
}

function GraficoPizza({ dados, largura, altura }: Omit<GraficoExplorarProps, 'tipo'>) {
  const cx = largura / 2;
  const cy = altura / 2;
  const r = Math.min(cx, cy) - 20;
  const total = dados.reduce((sum, d) => sum + d.value, 0) || 1;

  let angulo = -Math.PI / 2;
  const fatias = dados.map((d, i) => {
    const frac = d.value / total;
    const start = angulo;
    angulo += frac * 2 * Math.PI;
    const end = angulo;
    const largeArc = frac > 0.5 ? 1 : 0;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const pathD = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    return { pathD, label: d.label, value: d.value, cor: CORES[i % CORES.length] };
  });

  return (
    <g>
      {fatias.map((f) => (
        <path key={f.label} d={f.pathD} fill={f.cor}
          role="img" aria-label={`${f.label}: ${f.value}`} />
      ))}
    </g>
  );
}

export function GraficoExplorar({ tipo, dados, largura, altura }: GraficoExplorarProps) {
  if (tipo === 'table' || dados.length === 0) {
    return null;
  }

  return (
    <svg role="img" aria-label="Grafico do relatorio"
      viewBox={`0 0 ${largura} ${altura}`}
      style={{ width: '100%', maxWidth: `${largura}px`, height: `${altura}px` }}>
      {tipo === 'bar' ? (
        <GraficoBarra dados={dados} largura={largura} altura={altura} />
      ) : tipo === 'line' ? (
        <GraficoLinha dados={dados} largura={largura} altura={altura} />
      ) : tipo === 'pie' ? (
        <GraficoPizza dados={dados} largura={largura} altura={altura} />
      ) : null}
    </svg>
  );
}
