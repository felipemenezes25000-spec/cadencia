"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "../lib/cn";
import { PageHeader } from "../ui/PageHeader";
import { Tabs, TabsList, TabsTrigger } from "../ui/Tabs";

/* ── Tipos exportados ──────────────────────────────────────────────── */

export type AbaFinanceiro =
  | "visao"
  | "caixa"
  | "a-receber"
  | "a-pagar"
  | "recebimentos"
  | "repasse"
  | "cadastros"
  | "estoque";

export interface AbaConfig {
  readonly value: AbaFinanceiro;
  readonly rotulo: string;
  readonly href: string;
}

export const ABAS_FINANCEIRO: readonly AbaConfig[] = [
  { value: "visao", rotulo: "Visao geral", href: "/financeiro" },
  { value: "caixa", rotulo: "Caixa", href: "/financeiro/caixa" },
  { value: "a-receber", rotulo: "A receber", href: "/financeiro/a-receber" },
  { value: "a-pagar", rotulo: "A pagar", href: "/financeiro/a-pagar" },
  {
    value: "recebimentos",
    rotulo: "Recebimentos",
    href: "/financeiro/recebimentos",
  },
  { value: "repasse", rotulo: "Repasse", href: "/financeiro/repasse" },
  { value: "cadastros", rotulo: "Cadastros", href: "/financeiro/cadastros" },
  { value: "estoque", rotulo: "Estoque", href: "/financeiro/estoque" },
];

/* ── Props ─────────────────────────────────────────────────────────── */

export interface FinanceiroLayoutProps {
  readonly children: ReactNode;
  /** Contagem de recebimentos pendentes (badge na aba "A receber") */
  readonly pendentesReceber?: number | undefined;
  /** Contagem de pagamentos pendentes (badge na aba "A pagar") */
  readonly pendentesPagar?: number | undefined;
  /** Contagem de itens com estoque baixo (badge na aba "Estoque") */
  readonly baixoEstoque?: number | undefined;
}

/* ── Componente ────────────────────────────────────────────────────── */

export function FinanceiroLayout({
  children,
  pendentesReceber,
  pendentesPagar,
  baixoEstoque,
}: FinanceiroLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();

  /* Determina aba ativa a partir do pathname */
  const abaAtiva =
    ABAS_FINANCEIRO.find((a) => a.href === pathname)?.value ?? "visao";

  /* Mapa de badges por valor de aba */
  const badges: Partial<Record<AbaFinanceiro, number | undefined>> = {
    "a-receber": pendentesReceber,
    "a-pagar": pendentesPagar,
    estoque: baixoEstoque,
  };

  return (
    <div className="cadencia-page space-y-6 max-sm:p-4">
      <PageHeader titulo="Financeiro" semBreadcrumb />

      <Tabs
        value={abaAtiva}
        onValueChange={(value: string) => {
          const aba = ABAS_FINANCEIRO.find((a) => a.value === value);
          if (aba) router.push(aba.href);
        }}
      >
        <div
          className={cn(
            "overflow-x-auto scrollbar-thin",
            "-mx-1 px-1",
          )}
        >
          <TabsList className="min-w-max">
            {ABAS_FINANCEIRO.map((aba) => (
              <TabsTrigger
                key={aba.value}
                value={aba.value}
                badge={badges[aba.value]}
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
