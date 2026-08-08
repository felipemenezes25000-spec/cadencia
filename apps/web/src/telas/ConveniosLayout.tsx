// apps/web/src/telas/ConveniosLayout.tsx
"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "../lib/cn";
import { Tabs, TabsList, TabsTrigger } from "../ui/Tabs";

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
  lotesRascunho: "Lotes rascunho",
  lotesEnviados: "Lotes enviados",
  pendencias: "Pendencias",
  glosasPendentes: "Glosas pendentes",
  recursosRascunho: "Recursos rascunho",
};

/* ── Props ─────────────────────────────────────────────────────────── */

export interface ConveniosLayoutProps {
  readonly children: ReactNode;
  /** Contadores para badges nas abas e faixa de contadores */
  readonly contadores?: ContadoresConvenios;
  /** Callback ao clicar em um contador */
  readonly aoFiltrar?: (filtro: FiltroConvenios) => void;
  /** Filtro ativo (destaca o contador) */
  readonly filtroAtivo?: FiltroConvenios;

  /* ── Props legadas (backward compat) ─────────────────────────── */
  /** @deprecated Determinado automaticamente pelo pathname */
  readonly abaAtiva?: SubAbaConvenios;
  /** @deprecated Navegacao agora usa router.push */
  readonly aoNavegar?: (aba: SubAbaConvenios) => void;
}

/* ── Componente ────────────────────────────────────────────────────── */

export function ConveniosLayout({
  children,
  contadores,
  aoFiltrar,
  filtroAtivo,
  abaAtiva: abaAtivaLegada,
  aoNavegar,
}: ConveniosLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();

  /* Determina aba ativa a partir do pathname, fallback para prop legada */
  const abaAtiva =
    ABAS.find((a) => a.href === pathname)?.value ?? abaAtivaLegada ?? "a-faturar";

  const chaves = contadores
    ? (Object.keys(ROTULOS_CONTADORES) as FiltroConvenios[])
    : [];

  return (
    <div className="space-y-6 p-6 max-sm:p-4">
      {/* h2 porque ConveniosLayout e aninhado dentro de FinanceiroLayout (h1) */}
      <h2 className="text-xl font-semibold text-text tracking-tight">
        Convenios
      </h2>

      {/* Faixa de contadores */}
      {contadores && (
        <div
          role="group"
          aria-label="Contadores de convenios"
          aria-live="polite"
          className="flex rounded-md border border-line bg-surface overflow-hidden"
        >
          {chaves.map((k, i) => (
            <button
              key={k}
              type="button"
              onClick={() => aoFiltrar?.(k)}
              aria-pressed={filtroAtivo === k}
              className={cn(
                "flex-1 min-h-[44px] cursor-pointer",
                "grid gap-[var(--s-1)] justify-items-start",
                "py-[var(--s-5)] px-[var(--s-4)]",
                "border-0 text-text transition-colors-fast",
                i > 0 && "border-l border-line",
                filtroAtivo === k
                  ? "bg-surface-hover"
                  : "bg-transparent hover:bg-surface-hover",
              )}
            >
              <span className="text-[28px] font-semibold leading-tight tabular-nums">
                {contadores[k]}
              </span>
              <span className="text-[var(--fs-11)] uppercase tracking-[.04em] text-text-muted">
                {ROTULOS_CONTADORES[k]}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Abas de navegacao */}
      <Tabs
        value={abaAtiva}
        onValueChange={(value: string) => {
          const aba = ABAS.find((a) => a.value === value);
          if (aba) {
            /* Suporte a callback legada */
            if (aoNavegar) {
              aoNavegar(aba.value);
            }
            router.push(aba.href);
          }
        }}
      >
        <div
          className={cn(
            "overflow-x-auto scrollbar-thin",
            "-mx-6 px-6 max-sm:-mx-4 max-sm:px-4",
          )}
        >
          <TabsList className="min-w-max">
            {ABAS.map((aba) => (
              <TabsTrigger
                key={aba.value}
                value={aba.value}
                badge={
                  aba.badgeKey && contadores && contadores[aba.badgeKey] > 0
                    ? contadores[aba.badgeKey]
                    : undefined
                }
              >
                {aba.rotulo}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      {/* Conteudo da rota filha */}
      {children}
    </div>
  );
}
