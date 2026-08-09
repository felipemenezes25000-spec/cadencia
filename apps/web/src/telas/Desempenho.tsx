// apps/web/src/telas/Desempenho.tsx
"use client";

import { Suspense } from "react";
import { useQueryState } from "nuqs";
import { ChartLineUp, Pulse, Smiley, Stethoscope, TrendUp } from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { cn } from "../lib/cn";
import { PageHeader } from "../ui/PageHeader";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/Tabs";
import { Skeleton } from "../ui/Skeleton";

const PERIODOS = ["semana", "mes", "trimestre", "ano"] as const;
type Periodo = (typeof PERIODOS)[number];
const PERIODO_ROTULOS: Record<Periodo, string> = { semana: "Semana", mes: "Mes", trimestre: "Trimestre", ano: "Ano" };

const PILARES: ReadonlyArray<{ titulo: string; texto: string; icon: PhosphorIcon }> = [
  { titulo: "Demanda", texto: "Volume e origem", icon: ChartLineUp },
  { titulo: "Eficiência", texto: "Capacidade e tempo", icon: Pulse },
  { titulo: "Clínica", texto: "Mix de atendimentos", icon: Stethoscope },
  { titulo: "Experiência", texto: "Satisfação e retorno", icon: Smiley },
];

export function DesempenhoSkeleton() {
  return (
    <div className="cadencia-page space-y-6" data-testid="desempenho-skeleton">
      <div className="flex items-center justify-between"><Skeleton variant="text" width="220px" /><div className="flex gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} variant="text" width="80px" height="36px" />)}</div></div>
      <Skeleton variant="card" height="180px" className="rounded-[24px]" />
      <Skeleton variant="card" height="360px" />
    </div>
  );
}

function InsightPlaceholder({ tipo }: { readonly tipo: 'explorar' | 'variacoes' | 'atendimentos' | 'satisfacao' }) {
  const mapa = {
    explorar: { titulo: 'Explorar', texto: 'Cruze métricas, período e contexto para encontrar o que realmente move a clínica.', icon: ChartLineUp },
    variacoes: { titulo: 'Variacoes', texto: 'Entenda a diferença entre períodos como uma história de fatores, não como um número isolado.', icon: TrendUp },
    atendimentos: { titulo: 'Atendimentos', texto: 'Volume, mix, ocupação e qualidade operacional na mesma leitura.', icon: Stethoscope },
    satisfacao: { titulo: 'Satisfacao', texto: 'Sinais de experiência do paciente organizados para ação, não para relatório.', icon: Smiley },
  } as const;
  const item = mapa[tipo];
  const Icon = item.icon;
  return (
    <section aria-label={item.titulo} className="cadencia-panel cadencia-panel-hero min-h-[300px] overflow-hidden p-5 sm:p-7">
      <div className="grid min-h-[250px] items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(300px,.8fr)]">
        <div>
          <span className="cadencia-eyebrow">Inteligência operacional</span>
          <h2 className="m-0 mt-2 max-w-xl text-[clamp(1.45rem,3vw,2.2rem)] font-semibold leading-tight tracking-[-.045em] text-text">{item.titulo}</h2>
          <p className="m-0 mt-3 max-w-xl text-sm leading-relaxed text-text-muted">{item.texto}</p>
          <div className="mt-5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.1em] text-accent"><Pulse size={14} weight="fill" /> leitura contextual pronta para dados reais</div>
        </div>
        <div className="relative mx-auto h-[180px] w-full max-w-[380px] overflow-hidden rounded-[22px] border border-line/70 bg-surface/75 p-5 shadow-elev-2" aria-hidden>
          <div className="absolute -right-12 -top-12 h-36 w-36 rounded-full bg-accent/10 blur-3xl" />
          <div className="flex items-center justify-between"><span className="text-[9px] font-bold uppercase tracking-[.1em] text-text-faint">Signal canvas</span><Icon size={20} className="text-accent" weight="duotone" /></div>
          <div className="mt-8 flex h-20 items-end gap-2">
            {[38, 62, 48, 80, 67, 92, 74].map((h, i) => <span key={i} className="flex-1 rounded-t-[5px] bg-[linear-gradient(180deg,var(--accent),color-mix(in_oklab,var(--accent)_28%,transparent))]" style={{ height: `${h}%`, opacity: .45 + i * .07 }} />)}
          </div>
          <div className="mt-3 h-px bg-line" />
        </div>
      </div>
    </section>
  );
}

function DesempenhoConteudo() {
  const [periodo, setPeriodo] = useQueryState("periodo", { defaultValue: "mes" });
  const [aba, setAba] = useQueryState("aba", { defaultValue: "explorar" });

  return (
    <div className="cadencia-page space-y-6">
      <div className="flex items-end justify-between gap-5 max-sm:flex-col max-sm:items-stretch">
        <PageHeader titulo="Desempenho" subtitulo="Transforme operação em sinais claros de crescimento, qualidade e risco." semBreadcrumb className="pb-0" />
        <div className="cadencia-segmented overflow-x-auto" role="group" aria-label="Seletor de periodo">
          {PERIODOS.map((p) => (
            <button
              key={p} type="button" onClick={() => void setPeriodo(p)} aria-pressed={periodo === p}
              className={cn(
                "rounded-[9px] px-3 py-2 text-xs font-semibold transition-all duration-[var(--dur-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                periodo === p ? "bg-surface text-text shadow-elev-1 ring-1 ring-line/70" : "text-text-muted hover:text-text",
              )}
            >{PERIODO_ROTULOS[p]}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="group" aria-label="Pilares de desempenho">
        {PILARES.map(({ titulo, texto, icon: Icon }) => (
          <div key={titulo} className="cadencia-metric p-4"><div className="flex items-center gap-2"><span className="cadencia-icon-orb h-8 w-8"><Icon size={15} weight="duotone" /></span><div><strong className="block text-xs font-semibold text-text">{titulo}</strong><span className="block text-[9px] text-text-faint">{texto}</span></div></div></div>
        ))}
      </div>

      <Tabs value={aba} onValueChange={(v) => void setAba(v)}>
        <div className="mb-5 overflow-x-auto"><TabsList className="min-w-max"><TabsTrigger value="explorar">Explorar</TabsTrigger><TabsTrigger value="variacoes">Variacoes</TabsTrigger><TabsTrigger value="atendimentos">Atendimentos</TabsTrigger><TabsTrigger value="satisfacao">Satisfacao</TabsTrigger></TabsList></div>
        <TabsContent value="explorar"><InsightPlaceholder tipo="explorar" /></TabsContent>
        <TabsContent value="variacoes"><InsightPlaceholder tipo="variacoes" /></TabsContent>
        <TabsContent value="atendimentos"><InsightPlaceholder tipo="atendimentos" /></TabsContent>
        <TabsContent value="satisfacao"><InsightPlaceholder tipo="satisfacao" /></TabsContent>
      </Tabs>
    </div>
  );
}

export function Desempenho() {
  return <Suspense fallback={<DesempenhoSkeleton />}><DesempenhoConteudo /></Suspense>;
}
