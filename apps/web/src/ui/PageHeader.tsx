"use client";

import { type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Breadcrumb, type BreadcrumbItem } from "./Breadcrumb";

export interface PageHeaderProps {
  /** Titulo da pagina */
  readonly titulo: string;
  /** Subtitulo ou descricao curta */
  readonly subtitulo?: string;
  /** Acoes (botoes, menus) renderizados a direita */
  readonly acoes?: ReactNode;
  /** Itens de breadcrumb (se omitido, usa auto-geracao do Breadcrumb) */
  readonly breadcrumbs?: BreadcrumbItem[];
  /** Esconde breadcrumbs */
  readonly semBreadcrumb?: boolean;
  /** Classes adicionais */
  readonly className?: string;
}

export function PageHeader({
  titulo,
  subtitulo,
  acoes,
  breadcrumbs,
  semBreadcrumb = false,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("space-y-1 pb-6", className)}>
      {/* Breadcrumb */}
      {!semBreadcrumb &&
        (breadcrumbs ? (
          <Breadcrumb itens={breadcrumbs} />
        ) : (
          <Breadcrumb />
        ))}

      {/* Titulo + Acoes */}
      <div className="flex items-start justify-between gap-4 max-sm:flex-col">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-[var(--text)] tracking-tight">
            {titulo}
          </h1>
          {subtitulo && (
            <p className="text-sm text-[var(--text-soft)]">{subtitulo}</p>
          )}
        </div>

        {acoes && (
          <div className="flex items-center gap-2 shrink-0 max-sm:w-full max-sm:justify-end">
            {acoes}
          </div>
        )}
      </div>
    </div>
  );
}
