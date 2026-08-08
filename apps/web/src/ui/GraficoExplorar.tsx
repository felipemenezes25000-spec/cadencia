// apps/web/src/ui/GraficoExplorar.tsx
'use client';

import { cn } from '../lib/cn';
import type { ChartKind } from '@cadencia/reports';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { curveMonotoneX } from '@visx/curve';
import { GridRows } from '@visx/grid';
import { Group } from '@visx/group';
import { ParentSize } from '@visx/responsive';
import { scaleBand, scaleLinear, scaleOrdinal, scalePoint } from '@visx/scale';
import { Bar, LinePath, Pie } from '@visx/shape';
import { defaultStyles, TooltipWithBounds, useTooltip } from '@visx/tooltip';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface DadoGrafico {
  readonly label: string;
  readonly value: number;
  readonly cor?: string;
}

export interface GraficoExplorarProps {
  readonly tipo: ChartKind;
  readonly dados: readonly DadoGrafico[];
  /** Largura fixa (px). Quando omitido, usa ParentSize responsivo. */
  readonly largura?: number;
  /** Altura do grafico em px. Padrao: 300. */
  readonly altura?: number;
  /** Titulo exibido acima do grafico. */
  readonly titulo?: string;
  /** Rotulo do eixo X (bar/line). */
  readonly eixoX?: string;
  /** Rotulo do eixo Y (bar/line). */
  readonly eixoY?: string;
  readonly className?: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MARGEM = { top: 20, right: 20, bottom: 40, left: 60 };

const CORES_PIZZA = [
  'var(--accent)',
  'var(--ok)',
  'var(--warn)',
  'var(--ai)',
  'var(--danger)',
  'var(--text-muted)',
];

const TOOLTIP_STYLE = {
  ...defaultStyles,
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  color: 'var(--text)',
  padding: '8px 12px',
  borderRadius: 'var(--r-md)',
  boxShadow: 'var(--elev-2)',
} as const;

/* ------------------------------------------------------------------ */
/*  Internal props                                                     */
/* ------------------------------------------------------------------ */

interface InternalChartProps {
  readonly dados: readonly DadoGrafico[];
  readonly width: number;
  readonly height: number;
  readonly margin: typeof MARGEM;
  readonly eixoX?: string;
  readonly eixoY?: string;
}

/* ------------------------------------------------------------------ */
/*  Tooltip content                                                    */
/* ------------------------------------------------------------------ */

function TooltipConteudo({ data }: { readonly data: DadoGrafico }) {
  return (
    <>
      <p className="text-[var(--fs-11)] font-medium text-[var(--text-muted)]">
        {data.label}
      </p>
      <p className="text-[var(--fs-13)] font-bold text-[var(--text)]">
        {data.value.toLocaleString('pt-BR')}
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Bar chart                                                          */
/* ------------------------------------------------------------------ */

function GraficoBarras({ dados, width, height, margin, eixoX, eixoY }: InternalChartProps) {
  const { showTooltip, hideTooltip, tooltipData, tooltipLeft, tooltipTop, tooltipOpen } =
    useTooltip<DadoGrafico>();

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  if (innerWidth <= 0 || innerHeight <= 0) return null;

  const xScale = scaleBand<string>({
    range: [0, innerWidth],
    domain: dados.map((d) => d.label),
    padding: 0.3,
  });

  const yScale = scaleLinear<number>({
    range: [innerHeight, 0],
    domain: [0, Math.max(...dados.map((d) => d.value), 1) * 1.1],
    nice: true,
  });

  return (
    <div className="relative">
      <svg width={width} height={height} aria-hidden="true">
        <Group left={margin.left} top={margin.top}>
          <GridRows
            scale={yScale}
            width={innerWidth}
            stroke="var(--line)"
            strokeOpacity={0.5}
            strokeDasharray="2,3"
          />

          {dados.map((d) => {
            const barWidth = xScale.bandwidth();
            const barHeight = innerHeight - (yScale(d.value) ?? 0);
            const barX = xScale(d.label) ?? 0;
            const barY = innerHeight - barHeight;

            return (
              <Bar
                key={d.label}
                x={barX}
                y={barY}
                width={barWidth}
                height={Math.max(barHeight, 0)}
                fill={d.cor ?? 'var(--accent)'}
                rx={3}
                className="transition-all duration-300 ease-out hover:opacity-80"
                role="img"
                aria-label={`${d.label}: ${d.value}`}
                onMouseEnter={() => {
                  showTooltip({
                    tooltipData: d,
                    tooltipLeft: margin.left + barX + barWidth / 2,
                    tooltipTop: margin.top + barY,
                  });
                }}
                onMouseLeave={hideTooltip}
              />
            );
          })}

          <AxisBottom
            top={innerHeight}
            scale={xScale}
            label={eixoX}
            tickLabelProps={{ fill: 'var(--text-muted)', fontSize: 11, textAnchor: 'middle' as const }}
            labelProps={{ fill: 'var(--text-muted)', fontSize: 12 }}
            stroke="var(--line)"
            tickStroke="var(--line)"
          />
          <AxisLeft
            scale={yScale}
            label={eixoY}
            tickLabelProps={{ fill: 'var(--text-muted)', fontSize: 11, textAnchor: 'end' as const }}
            labelProps={{ fill: 'var(--text-muted)', fontSize: 12 }}
            stroke="var(--line)"
            tickStroke="var(--line)"
          />
        </Group>
      </svg>

      {tooltipOpen && tooltipData && (
        <TooltipWithBounds left={tooltipLeft} top={tooltipTop} style={TOOLTIP_STYLE}>
          <TooltipConteudo data={tooltipData} />
        </TooltipWithBounds>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Line chart                                                         */
/* ------------------------------------------------------------------ */

function GraficoLinha({ dados, width, height, margin, eixoX, eixoY }: InternalChartProps) {
  const { showTooltip, hideTooltip, tooltipData, tooltipLeft, tooltipTop, tooltipOpen } =
    useTooltip<DadoGrafico>();

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  if (innerWidth <= 0 || innerHeight <= 0) return null;

  const xScale = scalePoint<string>({
    domain: dados.map((d) => d.label),
    range: [0, innerWidth],
    padding: 0.5,
  });

  const yScale = scaleLinear<number>({
    range: [innerHeight, 0],
    domain: [0, Math.max(...dados.map((d) => d.value), 1) * 1.1],
    nice: true,
  });

  return (
    <div className="relative">
      <svg width={width} height={height} aria-hidden="true">
        <Group left={margin.left} top={margin.top}>
          <GridRows
            scale={yScale}
            width={innerWidth}
            stroke="var(--line)"
            strokeOpacity={0.5}
            strokeDasharray="2,3"
          />

          <LinePath
            data={[...dados]}
            x={(d) => xScale(d.label) ?? 0}
            y={(d) => yScale(d.value) ?? 0}
            stroke="var(--accent)"
            strokeWidth={2}
            curve={curveMonotoneX}
          />

          {dados.map((d) => (
            <circle
              key={d.label}
              cx={xScale(d.label) ?? 0}
              cy={yScale(d.value) ?? 0}
              r={4}
              fill={d.cor ?? 'var(--accent)'}
              stroke="var(--surface)"
              strokeWidth={2}
              role="img"
              aria-label={`${d.label}: ${d.value}`}
              onMouseEnter={() => {
                showTooltip({
                  tooltipData: d,
                  tooltipLeft: margin.left + (xScale(d.label) ?? 0),
                  tooltipTop: margin.top + (yScale(d.value) ?? 0),
                });
              }}
              onMouseLeave={hideTooltip}
            />
          ))}

          <AxisBottom
            top={innerHeight}
            scale={xScale}
            label={eixoX}
            tickLabelProps={{ fill: 'var(--text-muted)', fontSize: 11, textAnchor: 'middle' as const }}
            labelProps={{ fill: 'var(--text-muted)', fontSize: 12 }}
            stroke="var(--line)"
            tickStroke="var(--line)"
          />
          <AxisLeft
            scale={yScale}
            label={eixoY}
            tickLabelProps={{ fill: 'var(--text-muted)', fontSize: 11, textAnchor: 'end' as const }}
            labelProps={{ fill: 'var(--text-muted)', fontSize: 12 }}
            stroke="var(--line)"
            tickStroke="var(--line)"
          />
        </Group>
      </svg>

      {tooltipOpen && tooltipData && (
        <TooltipWithBounds left={tooltipLeft} top={tooltipTop} style={TOOLTIP_STYLE}>
          <TooltipConteudo data={tooltipData} />
        </TooltipWithBounds>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pie chart                                                          */
/* ------------------------------------------------------------------ */

function GraficoPizza({
  dados,
  width,
  height,
}: Pick<InternalChartProps, 'dados' | 'width' | 'height'>) {
  const { showTooltip, hideTooltip, tooltipData, tooltipLeft, tooltipTop, tooltipOpen } =
    useTooltip<DadoGrafico>();

  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(centerX, centerY) - 20;

  if (radius <= 0) return null;

  const colorScale = scaleOrdinal<string, string>({
    domain: dados.map((d) => d.label),
    range: CORES_PIZZA,
  });

  return (
    <div className="relative">
      <svg width={width} height={height} aria-hidden="true">
        <Group top={centerY} left={centerX}>
          <Pie
            data={[...dados]}
            pieValue={(d) => d.value}
            outerRadius={radius}
            padAngle={0.02}
            cornerRadius={3}
          >
            {(pie) =>
              pie.arcs.map((arc) => {
                const [centroidX, centroidY] = pie.path.centroid(arc);
                return (
                  <g key={arc.data.label}>
                    <path
                      d={pie.path(arc) ?? ''}
                      fill={arc.data.cor ?? colorScale(arc.data.label)}
                      className="transition-opacity duration-200 hover:opacity-80"
                      role="img"
                      aria-label={`${arc.data.label}: ${arc.data.value}`}
                      onMouseEnter={() => {
                        showTooltip({
                          tooltipData: arc.data,
                          tooltipLeft: centerX + centroidX,
                          tooltipTop: centerY + centroidY,
                        });
                      }}
                      onMouseLeave={hideTooltip}
                    />
                  </g>
                );
              })
            }
          </Pie>
        </Group>
      </svg>

      {tooltipOpen && tooltipData && (
        <TooltipWithBounds left={tooltipLeft} top={tooltipTop} style={TOOLTIP_STYLE}>
          <TooltipConteudo data={tooltipData} />
        </TooltipWithBounds>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function GraficoExplorar({
  tipo,
  dados,
  largura,
  altura = 300,
  titulo,
  eixoX,
  eixoY,
  className,
}: GraficoExplorarProps) {
  if (tipo === 'table' || dados.length === 0) return null;

  const margin = MARGEM;

  const renderChart = (width: number, height: number) => {
    if (width < 10) return null;

    switch (tipo) {
      case 'bar':
        return (
          <GraficoBarras
            dados={dados}
            width={width}
            height={height}
            margin={margin}
            eixoX={eixoX}
            eixoY={eixoY}
          />
        );
      case 'line':
        return (
          <GraficoLinha
            dados={dados}
            width={width}
            height={height}
            margin={margin}
            eixoX={eixoX}
            eixoY={eixoY}
          />
        );
      case 'pie':
        return <GraficoPizza dados={dados} width={width} height={height} />;
      default:
        return null;
    }
  };

  return (
    <div
      className={cn(
        'rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)]',
        className,
      )}
      role="img"
      aria-label="Grafico do relatorio"
    >
      {titulo && (
        <h3 className="px-[var(--s-6)] pt-[var(--s-6)] text-[var(--fs-14)] font-semibold text-[var(--text)]">
          {titulo}
        </h3>
      )}
      <div
        style={{
          height: altura,
          maxWidth: largura ? `${largura}px` : undefined,
        }}
      >
        {largura ? (
          renderChart(largura, altura)
        ) : (
          <ParentSize>
            {({ width, height }) => renderChart(width, height)}
          </ParentSize>
        )}
      </div>
    </div>
  );
}
