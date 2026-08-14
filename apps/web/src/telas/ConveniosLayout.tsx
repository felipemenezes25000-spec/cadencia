// apps/web/src/telas/ConveniosLayout.tsx
"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { cn } from "../lib/cn";
import { NavegacaoDeRotas } from "../ui/NavegacaoDeRotas";
import { PageHeader } from "../ui/PageHeader";

/* ── Tipos exportados ────────────────────────────────────────────── */

export type SubAbaConvenios =
  | "a-faturar"
  | "lotes"
  | "retornos"
  | "glosas"
  | "recursos"
  | "operadoras";

export interface ContadoresConvenios {
  readonly guiasAFaturar: number;
  readonly lotesRascunho: number;
  readonly lotesEnviados: number;
  readonly pendencias: number;
  readonly glosasPendentes: number;
  readonly recursosRascunho: number;
}

export type FiltroConvenios = keyof ContadoresConvenios;

export interface AbaConfig {
  readonly value: SubAbaConvenios;
  readonly rotulo: string;
  readonly href: string;
  readonly badgeKey?: FiltroConvenios;
}

const ABAS: readonly AbaConfig[] = [
  { value: "a-faturar", rotulo: "A faturar", href: "/convenios", badgeKey: "guiasAFaturar" },
  { value: "lotes", rotulo: "Lotes", href: "/convenios/lotes" },
  { value: "retornos", rotulo: "Retornos", href: "/convenios/retornos", badgeKey: "pendencias" },
  { value: "glosas", rotulo: "Glosas", href: "/convenios/glosas", badgeKey: "glosasPendentes" },
  { value: "recursos", rotulo: "Recursos", href: "/convenios/recursos" },
  { value: "operadoras", rotulo: "Operadoras", href: "/convenios/operadoras" },
];

const ROTULOS_CONTADORES: Record<FiltroConvenios, string> = {
  guiasAFaturar: "Guias a faturar",
  lotesRascunho: "Lotes em rascunho",
  lotesEnviados: "Lotes enviados",
  pendencias: "Pendências",
  glosasPendentes: "Glosas pendentes",
  recursosRascunho: "Recursos em rascunho",
};

export interface ConveniosLayoutProps {
  readonly children: ReactNode;
  readonly contadores?: ContadoresConvenios;
  readonly aoFiltrar?: (filtro: FiltroConvenios) => void;
  readonly filtroAtivo?: FiltroConvenios;
  readonly abaAtiva?: SubAbaConvenios;
  readonly aoNavegar?: (aba: SubAbaConvenios) => void;
}

export function ConveniosLayout({
  children,
  contadores,
  aoFiltrar,
  filtroAtivo,
  abaAtiva: abaAtivaLegada,
  aoNavegar,
}: ConveniosLayoutProps) {
  const pathname = usePathname();
  const abaAtiva =
    ABAS.find((a) => a.href === pathname)?.value ?? abaAtivaLegada ?? "a-faturar";
  const chaves = contadores
    ? (Object.keys(ROTULOS_CONTADORES) as FiltroConvenios[])
    : [];

  return (
    <div className="cadencia-page space-y-6 max-sm:p-4">
      <PageHeader
        titulo="Convênios"
        eyebrow="Ciclo de receita"
        subtitulo="Transforme atendimentos em faturamento e acompanhe cada etapa até o recebimento."
        semBreadcrumb
      />

      {contadores && (
        <div
          role="group"
          aria-label="Contadores de convênios"
          aria-live="polite"
          className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6"
        >
          {chaves.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => aoFiltrar?.(k)}
              aria-pressed={filtroAtivo === k}
              className={cn(
                "min-h-[88px] cursor-pointer rounded-xl border border-line bg-surface",
                "grid gap-1 justify-items-start content-center px-4 py-3",
                "text-text transition-colors-fast hover:border-line-strong hover:bg-surface-subtle",
                filtroAtivo === k
                  ? "border-accent/35 bg-accent-soft ring-1 ring-accent/10"
                  : "hover:border-line-strong hover:bg-surface-raised",
              )}
            >
              <span className="text-[26px] font-bold leading-tight tracking-[-0.04em] tabular-nums">
                {contadores[k]}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[.06em] text-text-muted">
                {ROTULOS_CONTADORES[k]}
              </span>
            </button>
          ))}
        </div>
      )}

      <NavegacaoDeRotas
        rotulo="Seções de convênios"
        ativa={abaAtiva}
        aoNavegar={(value) => aoNavegar?.(value as SubAbaConvenios)}
        itens={ABAS.map((aba) => ({
          ...aba,
          badge: aba.badgeKey && contadores && contadores[aba.badgeKey] > 0
            ? contadores[aba.badgeKey]
            : undefined,
        }))}
      />

      {children}
    </div>
  );
}
