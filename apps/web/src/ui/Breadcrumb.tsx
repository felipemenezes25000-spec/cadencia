"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CaretRight } from "@phosphor-icons/react";
import { cn } from "../lib/cn";
import { Icone } from "./Icone";

/** Mapa de segmentos de rota para rótulos em português */
const ROTULOS: Record<string, string> = {
  hoje: "Hoje",
  agenda: "Agenda",
  pacientes: "Pacientes",
  financeiro: "Financeiro",
  conversas: "Conversas",
  convenios: "Convênios",
  desempenho: "Desempenho",
  caixa: "Caixa",
  "a-receber": "A receber",
  "a-pagar": "A pagar",
  recebimentos: "Recebimentos",
  repasse: "Repasse",
  estoque: "Estoque",
  explorar: "Explorar",
  variacoes: "Variações",
  atendimentos: "Atendimentos",
  satisfacao: "Satisfação",
};

export interface BreadcrumbItem {
  /** Texto visível */
  rotulo: string;
  /** Link (undefined para item atual) */
  href?: string;
}

export interface BreadcrumbProps {
  /** Itens manuais (sobrescreve auto-geração) */
  readonly itens?: BreadcrumbItem[];
  /** Classes adicionais */
  readonly className?: string;
}

/**
 * Gera breadcrumbs a partir do pathname.
 * Ex: "/financeiro/caixa" -> [{ rotulo: "Financeiro", href: "/financeiro" }, { rotulo: "Caixa" }]
 */
function gerarItensDoPathname(pathname: string): BreadcrumbItem[] {
  const segmentos = pathname.split("/").filter(Boolean);
  if (segmentos.length === 0) return [];

  return segmentos.map((segmento, i): BreadcrumbItem => {
    const rotulo = ROTULOS[segmento] ?? segmento;
    const eUltimo = i === segmentos.length - 1;
    if (eUltimo) {
      return { rotulo };
    }
    return { rotulo, href: "/" + segmentos.slice(0, i + 1).join("/") };
  });
}

export function Breadcrumb({ itens: itensManuais, className }: BreadcrumbProps) {
  const pathname = usePathname();
  const itens = itensManuais ?? gerarItensDoPathname(pathname);

  if (itens.length === 0) return null;

  return (
    <nav
      aria-label="Navegação estrutural"
      className={cn("flex items-center gap-1 text-[11px] font-medium", className)}
    >
      <ol className="flex items-center gap-1.5">
        {itens.map((item, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && (
              <Icone
                icon={CaretRight}
                size="sm"
                className="text-text-faint"
              />
            )}
            {item.href ? (
              <Link
                href={item.href}
                className="rounded-md text-text-muted transition-colors duration-[var(--dur-2)] hover:text-accent"
              >
                {item.rotulo}
              </Link>
            ) : (
              <span className="text-text font-semibold" aria-current="page">
                {item.rotulo}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
