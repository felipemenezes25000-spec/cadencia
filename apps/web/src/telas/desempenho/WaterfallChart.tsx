// apps/web/src/telas/desempenho/WaterfallChart.tsx
'use client';

import { cn } from '../../lib/cn';
import type { WaterfallFactor } from './types';
import { Group } from '@visx/group';
import { Bar } from '@visx/shape';
import { scaleBand, scaleLinear } from '@visx/scale';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { ParentSize } from '@visx/responsive';
import { useTooltip, TooltipWithBounds } from '@visx/tooltip';

/* ── Tipos ─────────────────────────────────────────────────────────────── */

export interface WaterfallSegment {
  label: string;
  valor: number;
  tipo: 'positivo' | 'negativo' | 'total';
}

interface SegmentoCalculado {
  label: string;
  valor: number;
  tipo: 'positivo' | 'negativo' | 'total';
  start: number;
  end: number;
  factorId?: string;
}

/** API nova: segmentos tipados com titulo e altura opcionais. */
interface WaterfallChartPropsNovo {
  readonly dados: WaterfallSegment[];
  readonly titulo?: string;
  readonly altura?: number;
  readonly className?: string;
}

/** API legada (backward-compat com Desempenho.tsx). */
interface WaterfallChartPropsLegado {
  readonly factors: readonly WaterfallFactor[];
  readonly onFactorClick: (factorId: string) => void;
}

export type WaterfallChartProps = WaterfallChartPropsNovo | WaterfallChartPropsLegado;

/* ── Helpers ───────────────────────────────────────────────────────────── */

function isLegacyProps(props: WaterfallChartProps): props is WaterfallChartPropsLegado {
  return 'factors' in props;
}

function calcularSegmentos(
  dados: WaterfallSegment[],
  factorIds?: string[],
): SegmentoCalculado[] {
  let acumulado = 0;
  return dados.map((d, i): SegmentoCalculado => {
    const fid = factorIds?.[i];
    const base = {
      label: d.label,
      valor: d.valor,
      tipo: d.tipo,
      ...(fid !== undefined ? { factorId: fid } : {}),
    };
    if (d.tipo === 'total') {
      return { ...base, start: 0, end: d.valor };
    }
    const start = acumulado;
    acumulado += d.valor;
    return { ...base, start, end: acumulado };
  });
}

function factorsToSegmentos(factors: readonly WaterfallFactor[]): WaterfallSegment[] {
  return factors.map((f) => ({
    label: f.label,
    valor: f.valueCents,
    tipo: f.valueCents >= 0 ? ('positivo' as const) : ('negativo' as const),
  }));
}

function formatarRotulo(valor: number, tipo: string): string {
  const abs = Math.abs(valor);
  const reais = Math.trunc(abs / 100);
  const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${tipo === 'negativo' ? '-' : ''}R$ ${grouped}`;
}

function formatarMoeda(centavos: number): string {
  const abs = Math.abs(centavos);
  const reais = Math.trunc(abs / 100);
  const cents = abs % 100;
  const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${centavos < 0 ? '-' : ''}R$${grouped},${String(cents).padStart(2, '0')}`;
}

const CORES: Record<string, string> = {
  positivo: 'var(--ok)',
  negativo: 'var(--danger)',
  total: 'var(--text-muted)',
};

/* ── Componente interno (SVG) ──────────────────────────────────────────── */

interface WaterfallInnerProps {
  readonly dados: WaterfallSegment[];
  readonly width: number;
  readonly height: number;
  readonly factorIds?: string[];
  readonly onBarClick?: (factorId: string) => void;
}

function WaterfallInner({
  dados,
  width,
  height,
  factorIds,
  onBarClick,
}: WaterfallInnerProps) {
  const {
    showTooltip,
    hideTooltip,
    tooltipOpen,
    tooltipData,
    tooltipLeft,
    tooltipTop,
  } = useTooltip<SegmentoCalculado>();

  const margin = { top: 20, right: 20, bottom: 50, left: 70 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  if (innerWidth <= 0 || innerHeight <= 0) return null;

  const segmentos = calcularSegmentos(dados, factorIds);

  const xScale = scaleBand({
    range: [0, innerWidth],
    domain: dados.map((d) => d.label),
    padding: 0.25,
  });

  const allValues = segmentos.flatMap((s) => [s.start, s.end]);
  const yScale = scaleLinear({
    range: [innerHeight, 0],
    domain: [Math.min(0, ...allValues), Math.max(...allValues) * 1.1],
    nice: true,
  });

  return (
    <div style={{ position: 'relative' }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Grafico waterfall"
      >
        <Group left={margin.left} top={margin.top}>
          {/* Linhas conectoras */}
          {segmentos.map((seg, i) => {
            if (i === segmentos.length - 1) return null;
            const nextSeg = segmentos[i + 1]!;
            return (
              <line
                key={`connector-${seg.label}`}
                x1={(xScale(seg.label) ?? 0) + xScale.bandwidth()}
                y1={yScale(seg.end)}
                x2={xScale(nextSeg.label) ?? 0}
                y2={yScale(seg.end)}
                stroke="var(--line)"
                strokeDasharray="2,2"
                data-testid="connector-line"
              />
            );
          })}

          {/* Barras */}
          {segmentos.map((seg) => {
            const barX = xScale(seg.label) ?? 0;
            const barTop = yScale(Math.max(seg.start, seg.end));
            const barBottom = yScale(Math.min(seg.start, seg.end));
            const barHeight = barBottom - barTop;
            const isClickable = onBarClick != null && seg.factorId != null;

            return (
              <g key={seg.label}>
                <Bar
                  x={barX}
                  y={barTop}
                  width={xScale.bandwidth()}
                  height={Math.max(barHeight, 1)}
                  fill={CORES[seg.tipo]}
                  rx={2}
                  data-testid={`bar-${seg.tipo}`}
                  role={isClickable ? 'button' : undefined}
                  aria-label={isClickable ? seg.label : undefined}
                  tabIndex={isClickable ? 0 : undefined}
                  style={{
                    cursor: isClickable ? 'pointer' : 'default',
                    transition: 'opacity var(--dur-2) var(--ease-out)',
                  }}
                  onClick={() => {
                    if (onBarClick && seg.factorId) {
                      onBarClick(seg.factorId);
                    }
                  }}
                  onKeyDown={(e: React.KeyboardEvent) => {
                    if (
                      (e.key === 'Enter' || e.key === ' ') &&
                      onBarClick &&
                      seg.factorId
                    ) {
                      e.preventDefault();
                      onBarClick(seg.factorId);
                    }
                  }}
                  onMouseEnter={() => {
                    showTooltip({
                      tooltipData: seg,
                      tooltipLeft:
                        barX + margin.left + xScale.bandwidth() / 2,
                      tooltipTop: barTop + margin.top - 10,
                    });
                  }}
                  onMouseLeave={hideTooltip}
                />
                {/* Rotulo de valor acima/abaixo da barra */}
                <text
                  x={barX + xScale.bandwidth() / 2}
                  y={barTop - 6}
                  textAnchor="middle"
                  fill={CORES[seg.tipo]}
                  fontSize={11}
                  fontWeight={600}
                  aria-hidden="true"
                >
                  {formatarRotulo(seg.valor, seg.tipo)}
                </text>
              </g>
            );
          })}

          {/* Eixos */}
          <AxisBottom
            top={innerHeight}
            scale={xScale}
            tickLabelProps={{
              fill: 'var(--text-muted)',
              fontSize: 11,
              textAnchor: 'middle' as const,
            }}
            stroke="var(--line)"
            tickStroke="var(--line)"
          />
          <AxisLeft
            scale={yScale}
            tickFormat={(v) => {
              const reais = Math.round((v as number) / 100);
              const grouped = String(Math.abs(reais)).replace(
                /\B(?=(\d{3})+(?!\d))/g,
                '.',
              );
              return `${reais < 0 ? '-' : ''}R$${grouped}`;
            }}
            tickLabelProps={{
              fill: 'var(--text-muted)',
              fontSize: 11,
              textAnchor: 'end' as const,
            }}
            stroke="var(--line)"
            tickStroke="var(--line)"
          />
        </Group>
      </svg>

      {/* Tooltip */}
      {tooltipOpen && tooltipData != null && (
        <TooltipWithBounds
          left={tooltipLeft ?? 0}
          top={tooltipTop ?? 0}
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-md)',
            padding: 'var(--s-3) var(--s-4)',
            boxShadow: 'var(--elev-2)',
            color: 'var(--text)',
            pointerEvents: 'none',
          }}
        >
          <p
            className="m-0 text-[11px] font-medium"
            style={{ color: 'var(--text-muted)' }}
          >
            {tooltipData.label}
          </p>
          <p className="m-0 text-sm font-bold">
            {formatarMoeda(tooltipData.valor)}
          </p>
        </TooltipWithBounds>
      )}
    </div>
  );
}

/* ── Componente publico ────────────────────────────────────────────────── */

export function WaterfallChart(props: WaterfallChartProps) {
  if (isLegacyProps(props)) {
    const { factors, onFactorClick } = props;
    const dados = factorsToSegmentos(factors);
    const factorIds = factors.map((f) => f.factorId);

    return (
      <div style={{ height: 300 }}>
        <ParentSize>
          {({ width, height }) =>
            width > 10 ? (
              <WaterfallInner
                dados={dados}
                width={width}
                height={height}
                factorIds={factorIds}
                onBarClick={onFactorClick}
              />
            ) : null
          }
        </ParentSize>
      </div>
    );
  }

  const { dados, titulo, altura = 300, className } = props;

  return (
    <div className={cn('rounded-[18px] border border-line/75 bg-surface/94 shadow-elev-1', className)}>
      {titulo != null && (
        <h3 className="m-0 px-[var(--s-4)] pt-[var(--s-4)] text-sm font-semibold text-text">
          {titulo}
        </h3>
      )}
      <div style={{ height: altura }}>
        <ParentSize>
          {({ width, height }) =>
            width > 10 ? (
              <WaterfallInner dados={dados} width={width} height={height} />
            ) : null
          }
        </ParentSize>
      </div>
    </div>
  );
}
