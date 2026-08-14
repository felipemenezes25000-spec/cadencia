"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { PageHeader } from "../ui/PageHeader";
import { NavegacaoDeRotas } from "../ui/NavegacaoDeRotas";

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
  { value: "visao", rotulo: "Visão geral", href: "/financeiro" },
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
      <PageHeader
        titulo="Financeiro"
        subtitulo="Gestão financeira da unidade"
        semBreadcrumb
        /* Havia aqui um botão "Novo recebimento" apontando para
           `/financeiro/recebimentos?novo=1`. Ninguém lê `novo` nessa tela e não
           existe `POST` de recebível na API — recebível nasce como efeito da
           cobrança de um atendimento, não de um cadastro avulso. O botão
           navegava para a lista e não abria nada: o usuário clicava e concluía,
           com razão, que o financeiro estava quebrado. Enquanto o fluxo de
           lançamento avulso não existir de ponta a ponta, não há botão. */
      />

      <NavegacaoDeRotas
        rotulo="Seções financeiras"
        ativa={abaAtiva}
        itens={ABAS_FINANCEIRO.map((aba) => ({ ...aba, badge: badges[aba.value] }))}
      />

      {/* Conteúdo da rota filha */}
      {children}
    </div>
  );
}
