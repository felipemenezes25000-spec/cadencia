// apps/web/src/telas/Desempenho.tsx
"use client";

import { Suspense } from "react";
import { useQueryState } from "nuqs";
import { cn } from "../lib/cn";
import { PageHeader } from "../ui/PageHeader";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/Tabs";
import { Skeleton } from "../ui/Skeleton";

/* ── Tipos e constantes ────────────────────────────────────────────── */

const PERIODOS = ["semana", "mes", "trimestre", "ano"] as const;
type Periodo = (typeof PERIODOS)[number];

const PERIODO_ROTULOS: Record<Periodo, string> = {
  semana: "Semana",
  mes: "Mês",
  trimestre: "Trimestre",
  ano: "Ano",
};

/* ── Skeleton de carregamento ──────────────────────────────────────── */

export function DesempenhoSkeleton() {
  return (
    <div className="cadencia-page space-y-6" data-testid="desempenho-skeleton">
      <div className="flex items-center justify-between">
        <Skeleton variant="text" width="200px" />
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} variant="text" width="80px" height="36px" />
          ))}
        </div>
      </div>
      <Skeleton variant="text" width="300px" height="40px" />
      <Skeleton variant="card" height="400px" />
    </div>
  );
}

/* ── Conteúdo principal ────────────────────────────────────────────── */

function DesempenhoConteudo() {
  const [periodo, setPeriodo] = useQueryState("periodo", {
    defaultValue: "mes",
  });
  const [aba, setAba] = useQueryState("aba", { defaultValue: "explorar" });

  return (
    <div className="cadencia-page space-y-6">
      {/* Header + seletor de período */}
      <div className="flex items-center justify-between max-sm:flex-col max-sm:items-start max-sm:gap-3">
        <PageHeader titulo="Desempenho" semBreadcrumb className="pb-0" />

        <div
          className="flex items-center gap-2"
          role="group"
          aria-label="Seletor de período"
        >
          {PERIODOS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => void setPeriodo(p)}
              aria-pressed={periodo === p}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-semibold",
                "transition-colors duration-[var(--dur-2)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                periodo === p
                  ? "border-accent bg-accent text-white shadow-elev-1"
                  : "border-line bg-surface text-text-muted hover:border-line-strong hover:text-text hover:bg-surface-raised",
              )}
            >
              {PERIODO_ROTULOS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Abas de navegação */}
      <Tabs
        value={aba}
        onValueChange={(v) => void setAba(v)}
      >
        <TabsList className="overflow-x-auto max-sm:scrollbar-none">
          <TabsTrigger value="explorar">Explorar</TabsTrigger>
          <TabsTrigger value="variacoes">Variações</TabsTrigger>
          <TabsTrigger value="atendimentos">Atendimentos</TabsTrigger>
          <TabsTrigger value="satisfacao">Satisfação</TabsTrigger>
        </TabsList>

        <TabsContent value="explorar">
          <section
            aria-label="Explorar"
            className="rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-elev-1 p-6"
          >
            <p className="text-sm text-[var(--text-muted)]">
              Selecione uma visão para explorar dados do período.
            </p>
          </section>
        </TabsContent>

        <TabsContent value="variacoes">
          <section
            aria-label="Variações"
            className="rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-elev-1 p-6"
          >
            <p className="text-sm text-[var(--text-muted)]">
              Variações do período selecionado.
            </p>
          </section>
        </TabsContent>

        <TabsContent value="atendimentos">
          <section
            aria-label="Atendimentos"
            className="rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-elev-1 p-6"
          >
            <p className="text-sm text-[var(--text-muted)]">
              Resumo de atendimentos do período.
            </p>
          </section>
        </TabsContent>

        <TabsContent value="satisfacao">
          <section
            aria-label="Satisfação"
            className="rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-elev-1 p-6"
          >
            <p className="text-sm text-[var(--text-muted)]">
              Indicadores de satisfação e NPS.
            </p>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ── Componente exportado ──────────────────────────────────────────── */

export function Desempenho() {
  return (
    <Suspense fallback={<DesempenhoSkeleton />}>
      <DesempenhoConteudo />
    </Suspense>
  );
}
