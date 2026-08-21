// apps/web/src/telas/FinanceiroVisao.tsx
'use client';

import { useEffect, useState } from 'react';
import { Group } from '@visx/group';
import { Bar } from '@visx/shape';
import { scaleBand, scaleLinear } from '@visx/scale';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { ParentSize } from '@visx/responsive';
import { TrendUp, TrendDown, Wallet, Clock } from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Icone } from '../ui/Icone';
import { Skeleton } from '../ui/Skeleton';
import { FinanceiroAReceber, type AReceberDados } from './FinanceiroAReceber';

// -- Tipos ------------------------------------------------------------------

export interface ReceitaVsDespesaItem {
  readonly mes: string;
  readonly receita: number;
  readonly despesa: number;
}

export interface SaldoProjetadoItem {
  readonly dia: string;
  readonly saldo: number;
}

export interface CategoriaItem {
  readonly nome: string;
  readonly total: number;
  readonly percentual: number;
}

export interface AlertaItem {
  readonly tipo: string;
  readonly mensagem: string;
  readonly severidade: 'danger' | 'warn' | 'ok';
}

export interface ResumoMes {
  readonly receitaTotal: number;
  readonly despesaTotal: number;
  readonly saldo: number;
  readonly pendente?: number;
  readonly variacaoReceita?: number;
  readonly variacaoDespesa?: number;
}

export interface DadosReceita {
  readonly label: string;
  readonly valor: number;
}

export interface VisaoDados {
  readonly receitaVsDespesa: readonly ReceitaVsDespesaItem[];
  readonly saldoProjetado: readonly SaldoProjetadoItem[];
  readonly topCategorias: readonly CategoriaItem[];
  readonly alertas: readonly AlertaItem[];
  readonly resumoMes: ResumoMes;
}

export interface FinanceiroVisaoProps {
  readonly dados?: never;
  readonly carregarDados: () => Promise<VisaoDados>;
  readonly carregarAReceber?: () => Promise<AReceberDados>;
  readonly aoCobrar?: (entryId: string) => Promise<void>;
  readonly aoMarcarPago?: (entryId: string) => Promise<void>;
  readonly aoEnviarLink?: (entryId: string) => Promise<void>;
  readonly hoje?: string;
}

// -- Helpers ----------------------------------------------------------------

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

type CorCard = 'sucesso' | 'erro' | 'aviso' | 'info';

const corBgClasses: Record<CorCard, string> = {
  sucesso: 'bg-ok-soft',
  erro: 'bg-danger-soft',
  aviso: 'bg-warn-soft',
  info: 'bg-accent-soft',
};

const corTextClasses: Record<CorCard, string> = {
  sucesso: 'text-ok',
  erro: 'text-danger',
  aviso: 'text-warn',
  info: 'text-accent',
};

const TOKEN_SEVERIDADE: Record<string, string> = {
  danger: 'text-danger',
  warn: 'text-warn',
  ok: 'text-ok',
};

const BG_SEVERIDADE: Record<string, string> = {
  danger: 'bg-danger-soft',
  warn: 'bg-warn-soft',
  ok: 'bg-ok-soft',
};

const GLIFO_SEVERIDADE: Record<string, string> = {
  danger: '!',
  warn: '!',
  ok: '✓',
};

// -- CardResumo -------------------------------------------------------------

function CardResumo({
  rotulo,
  valor,
  icone: Icon,
  cor,
  variacao,
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly icone: PhosphorIcon;
  readonly cor: CorCard;
  readonly variacao?: number;
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-line bg-surface p-4 transition-colors-fast hover:border-line-strong">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-text-muted">{rotulo}</span>
        <div className={cn('rounded-md p-1.5', corBgClasses[cor])}>
          <Icone icon={Icon} size="sm" className={corTextClasses[cor]} />
        </div>
      </div>
      <p className="text-[22px] font-bold tracking-[-0.04em] text-text tabular-nums">{valor}</p>
      {variacao != null && (
        <p
          className={cn(
            'mt-1 flex items-center gap-1 text-xs',
            variacao >= 0 ? 'text-ok' : 'text-danger',
          )}
        >
          <Icone icon={variacao >= 0 ? TrendUp : TrendDown} size="sm" />
          {Math.abs(variacao).toFixed(1)}% vs. período anterior
        </p>
      )}
    </div>
  );
}

// -- Graficos (visx) --------------------------------------------------------

/**
 * CORES DAS DUAS SERIES, e por que NAO sao as dos cards de resumo.
 *
 * Os cards acima ja pintam Receita de verde (`--success`) e Despesa de vermelho
 * (`--danger`), e o reflexo seria repetir isso no grafico. Passei o par pelo
 * validador de paleta: `#28734e` contra `#a04249` da ΔE 2,6 sob DEUTERANOPIA —
 * ou seja, para cerca de 8% dos homens as duas barras sao a mesma cor. Num
 * grafico de receita contra despesa isso nao e detalhe estetico: a leitura
 * inteira depende de separar as duas series.
 *
 * O par abaixo (azul de marca contra o mesmo vermelho) da ΔE 16,9 em
 * deuteranopia e 23,9 em visao normal, e passa em todos os cinco checks. O
 * verde some do grafico e fica so nos cards, onde a cor acompanha um rotulo
 * escrito e nao carrega sozinha a distincao.
 *
 * Mesmo passando, a identidade nunca depende so da cor: ha legenda, e as barras
 * de cada mes ficam lado a lado com 2px de respiro entre elas.
 */
const COR_RECEITA = 'var(--brand)';
const COR_DESPESA = 'var(--danger)';

const MARGEM = { top: 10, right: 12, bottom: 30, left: 64 };

/** 'R$ 1,2 mil' — o eixo nao comporta o valor cheio e ninguem le centavo em eixo. */
function reaisCurto(centavos: number): string {
  const reais = centavos / 100;
  if (Math.abs(reais) >= 1000) return `R$${(reais / 1000).toFixed(1)}k`;
  return `R$${reais.toFixed(0)}`;
}

function Legenda({ itens }: {
  readonly itens: readonly { cor: string; rotulo: string }[];
}) {
  return (
    <ul className="flex flex-wrap items-center gap-4">
      {itens.map((i) => (
        <li key={i.rotulo} className="flex items-center gap-2 text-xs font-medium text-text-muted">
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: i.cor }} />
          {i.rotulo}
        </li>
      ))}
    </ul>
  );
}

/**
 * Receita CONTRA despesa, e nao receita sozinha.
 *
 * A rota `/v1/financeiro/visao` sempre devolveu os dois valores por mes, e a
 * tela plotava so `item.receita`, descartando `item.despesa` no `.map()`. Um
 * painel financeiro que tem os dois numeros e desenha um deles mostra
 * faturamento crescendo sem dizer que o custo cresceu mais — que e exatamente a
 * pergunta que a gestora abre esta tela para responder.
 *
 * UM eixo so, porque as duas series sao a mesma grandeza (centavos). Dois eixos
 * y permitiriam escalar as barras independentemente e fabricar qualquer
 * narrativa visual.
 */
function GraficoReceitaDespesa({ dados }: {
  readonly dados: readonly ReceitaVsDespesaItem[];
}) {
  if (dados.length === 0) return null;

  const maximo = Math.max(...dados.flatMap((d) => [d.receita, d.despesa]), 1);

  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-elev-1">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text">Receita e despesa por mês</h3>
        <Legenda itens={[
          { cor: COR_RECEITA, rotulo: 'Receita' },
          { cor: COR_DESPESA, rotulo: 'Despesa' },
        ]} />
      </div>
      <div className="h-64" data-testid="grafico-receita">
        <ParentSize>
          {({ width, height }) => {
            if (width <= 0 || height <= 0) return null;
            const innerWidth = width - MARGEM.left - MARGEM.right;
            const innerHeight = height - MARGEM.top - MARGEM.bottom;
            if (innerWidth <= 0 || innerHeight <= 0) return null;

            const xMes = scaleBand({
              range: [0, innerWidth], domain: dados.map((d) => d.mes), padding: 0.28,
            });
            /* Escala aninhada: as duas barras do mes dividem a faixa dele. O
               `padding` interno e o respiro de 2px entre fills que impede as
               duas cores de encostarem e formarem uma barra so. */
            const xSerie = scaleBand({
              range: [0, xMes.bandwidth()], domain: ['receita', 'despesa'], padding: 0.12,
            });
            const y = scaleLinear({ range: [innerHeight, 0], domain: [0, maximo], nice: true });

            return (
              <svg width={width} height={height} role="img"
                aria-label="Receita e despesa por mês, últimos seis meses">
                <Group left={MARGEM.left} top={MARGEM.top}>
                  {dados.map((d) => (
                    <Group key={d.mes} left={xMes(d.mes) ?? 0}>
                      <Bar
                        x={xSerie('receita') ?? 0} y={y(d.receita)}
                        width={xSerie.bandwidth()} height={innerHeight - y(d.receita)}
                        fill={COR_RECEITA} rx={3}
                      />
                      <Bar
                        x={xSerie('despesa') ?? 0} y={y(d.despesa)}
                        width={xSerie.bandwidth()} height={innerHeight - y(d.despesa)}
                        fill={COR_DESPESA} rx={3}
                      />
                    </Group>
                  ))}
                  <AxisBottom
                    top={innerHeight} scale={xMes}
                    tickFormat={(v) => String(v).slice(5)}
                    tickLabelProps={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    stroke="var(--line)" tickStroke="var(--line)"
                  />
                  <AxisLeft
                    scale={y} numTicks={5}
                    tickFormat={(v) => reaisCurto(v as number)}
                    tickLabelProps={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    stroke="var(--line)" tickStroke="var(--line)"
                  />
                </Group>
              </svg>
            );
          }}
        </ParentSize>
      </div>
    </div>
  );
}

/**
 * Saldo diario dos ultimos 30 dias.
 *
 * `saldoProjetado` vinha da API desde sempre, estava declarado em `VisaoDados` e
 * NUNCA foi renderizado: trinta pontos de saldo por dia chegavam no navegador e
 * eram descartados. E o dado que responde "em que dia do mes o caixa aperta",
 * que nenhum total mensal mostra.
 *
 * Serie unica, entao sem legenda — o titulo nomeia. Barra e nao linha porque o
 * saldo diario CRUZA O ZERO, e barra ancorada na linha de base torna o dia
 * negativo imediatamente legivel; uma linha faria o zero virar mais um valor
 * qualquer no eixo.
 */
function GraficoSaldoDiario({ dados }: {
  readonly dados: readonly SaldoProjetadoItem[];
}) {
  if (dados.length === 0) return null;

  const valores = dados.map((d) => d.saldo);
  const maximo = Math.max(...valores, 0);
  const minimo = Math.min(...valores, 0);

  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-elev-1">
      <h3 className="mb-1 text-sm font-semibold text-text">Saldo por dia</h3>
      <p className="mb-3 text-xs text-text-muted">
        Últimos 30 dias · entradas menos saídas de cada dia
      </p>
      <div className="h-56" data-testid="grafico-saldo-diario">
        <ParentSize>
          {({ width, height }) => {
            if (width <= 0 || height <= 0) return null;
            const innerWidth = width - MARGEM.left - MARGEM.right;
            const innerHeight = height - MARGEM.top - MARGEM.bottom;
            if (innerWidth <= 0 || innerHeight <= 0) return null;

            const x = scaleBand({
              range: [0, innerWidth], domain: dados.map((d) => d.dia), padding: 0.25,
            });
            const y = scaleLinear({
              range: [innerHeight, 0], domain: [minimo, maximo], nice: true,
            });
            const zero = y(0);

            return (
              <svg width={width} height={height} role="img"
                aria-label="Saldo diário dos últimos 30 dias">
                <Group left={MARGEM.left} top={MARGEM.top}>
                  {dados.map((d) => {
                    const negativo = d.saldo < 0;
                    const topo = negativo ? zero : y(d.saldo);
                    return (
                      <Bar
                        key={d.dia}
                        x={x(d.dia) ?? 0} y={topo}
                        width={x.bandwidth()}
                        height={Math.abs(y(d.saldo) - zero)}
                        /* Aqui o vermelho E status: o dia fechou negativo. Nao e
                           identidade de serie, e o proprio valor mudando de sinal. */
                        fill={negativo ? COR_DESPESA : COR_RECEITA}
                        rx={2}
                      />
                    );
                  })}
                  <line x1={0} x2={innerWidth} y1={zero} y2={zero} stroke="var(--line-strong)" />
                  <AxisBottom
                    top={innerHeight} scale={x}
                    /* Trinta rotulos de data nao cabem: mostra um a cada cinco. */
                    tickValues={dados.filter((_, i) => i % 5 === 0).map((d) => d.dia)}
                    tickFormat={(v) => String(v).slice(8)}
                    tickLabelProps={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    stroke="var(--line)" tickStroke="var(--line)"
                  />
                  <AxisLeft
                    scale={y} numTicks={4}
                    tickFormat={(v) => reaisCurto(v as number)}
                    tickLabelProps={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    stroke="var(--line)" tickStroke="var(--line)"
                  />
                </Group>
              </svg>
            );
          }}
        </ParentSize>
      </div>
    </div>
  );
}

// -- Skeleton ---------------------------------------------------------------

function FinanceiroVisaoSkeleton() {
  return (
    <div className="space-y-6" data-testid="financeiro-visao-skeleton">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} variant="card" height="100px" />
        ))}
      </div>
      <Skeleton variant="text" width="200px" height="36px" />
      <Skeleton variant="card" height="280px" />
    </div>
  );
}

// -- Alertas ----------------------------------------------------------------

function SecaoAlertas({ alertas }: { readonly alertas: readonly AlertaItem[] }) {
  if (alertas.length === 0) return null;

  return (
    <section aria-label="Alertas financeiros" className="grid gap-[var(--s-3)]">
      {alertas.map((a) => (
        <div
          key={a.tipo}
          role="alert"
          className={cn(
            'flex items-center gap-[var(--s-4)] rounded-[var(--r-md)] px-[var(--s-5)] py-[var(--s-4)] text-[length:var(--fs-13)]',
            BG_SEVERIDADE[a.severidade] ?? 'bg-warn-soft',
            TOKEN_SEVERIDADE[a.severidade] ?? 'text-warn',
          )}
        >
          <span aria-hidden="true" className="font-semibold">
            {GLIFO_SEVERIDADE[a.severidade] ?? '!'}
          </span>
          {a.mensagem}
        </div>
      ))}
    </section>
  );
}

// -- Top Categorias ---------------------------------------------------------

function SecaoCategorias({ categorias }: { readonly categorias: readonly CategoriaItem[] }) {
  return (
    <section
      aria-label="Principais categorias"
      className="rounded-xl border border-line bg-surface shadow-elev-1 p-[var(--s-6)]"
    >
      <h2 className="mb-[var(--s-4)] text-[length:var(--fs-15)] font-semibold">Principais categorias</h2>
      <ul className="m-0 grid list-none gap-[var(--s-3)] p-0">
        {categorias.map((c) => (
          <li
            key={c.nome}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-[var(--s-4)] border-b border-line py-[var(--s-2)] text-[length:var(--fs-14)]"
          >
            <span>{c.nome}</span>
            <span className="tabular-nums text-text-muted">
              {centavosParaReais(c.total)}
            </span>
            <span className="min-w-[3ch] text-right font-medium tabular-nums">
              {c.percentual}%
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// -- Componente principal ---------------------------------------------------

export function FinanceiroVisao(p: FinanceiroVisaoProps) {
  const [dados, setDados] = useState<VisaoDados | null>(null);

  /* Havia aqui um `SeletorPeriodo` com Semana/Mês/Trimestre/Ano gravando em
     `?periodo=`. Ele nao filtrava NADA: `carregarDados()` nao recebe argumento,
     o efeito abaixo nao depende do periodo, e `/v1/financeiro/visao` nao aceita
     recorte — a serie e sempre de seis meses. A unica coisa que o clique mudava
     era o titulo do grafico, que passava a mentir ("Receita por semana" sobre
     dados mensais). Removido junto com o resto dos controles decorativos; volta
     quando a rota aceitar o parametro. */
  useEffect(() => {
    void p.carregarDados().then(setDados);
  }, [p.carregarDados]);

  if (dados === null) return <FinanceiroVisaoSkeleton />;

  const resumo = dados.resumoMes;

  return (
    <div className="grid gap-[var(--s-8)]">
      {/* Cards de resumo */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <CardResumo
          rotulo="Receita"
          valor={centavosParaReais(resumo.receitaTotal)}
          icone={TrendUp}
          cor="sucesso"
          {...(resumo.variacaoReceita != null ? { variacao: resumo.variacaoReceita } : {})}
        />
        <CardResumo
          rotulo="Despesa"
          valor={centavosParaReais(resumo.despesaTotal)}
          icone={TrendDown}
          cor="erro"
          {...(resumo.variacaoDespesa != null ? { variacao: resumo.variacaoDespesa } : {})}
        />
        <CardResumo
          rotulo="Saldo"
          valor={centavosParaReais(resumo.saldo)}
          icone={Wallet}
          cor={resumo.saldo >= 0 ? 'sucesso' : 'erro'}
        />
        <CardResumo
          rotulo="Pendente"
          valor={centavosParaReais(resumo.pendente ?? 0)}
          icone={Clock}
          cor="aviso"
        />
      </div>

      {/* Alertas */}
      <SecaoAlertas alertas={dados.alertas} />

      {p.carregarAReceber && p.aoCobrar && p.aoMarcarPago && p.aoEnviarLink ? (
        <section aria-label="Contas a receber" className="rounded-2xl border border-line bg-surface p-5">
          <FinanceiroAReceber
            carregarDados={p.carregarAReceber}
            aoCobrar={p.aoCobrar}
            aoMarcarPago={p.aoMarcarPago}
            aoEnviarLink={p.aoEnviarLink}
            hoje={p.hoje ?? new Date().toISOString().slice(0, 10)}
          />
        </section>
      ) : null}

      {/* Os graficos estavam dentro de um `<details>` FECHADO por padrao,
          rotulado "Análise do período". Quem abria o Financeiro via quatro
          cartoes, os alertas e a lista de a receber, e concluia — sem estar
          errado — que a tela nao tinha grafico nenhum. Analise de receita
          contra despesa nao e conteudo secundario num painel financeiro: e o
          motivo de a tela existir. Sai de tras da gaveta. */}
      <section aria-label="Análise financeira" className="grid gap-5">
        <div>
          <p className="cadencia-eyebrow">Análise</p>
          <h2 className="mt-1 text-lg font-bold tracking-[-0.025em] text-text">Para onde o dinheiro está indo</h2>
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          <GraficoReceitaDespesa dados={dados.receitaVsDespesa} />
          <GraficoSaldoDiario dados={dados.saldoProjetado} />
        </div>
        <SecaoCategorias categorias={dados.topCategorias} />
      </section>
    </div>
  );
}
