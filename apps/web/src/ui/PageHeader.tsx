"use client";

import { type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Breadcrumb, type BreadcrumbItem } from "./Breadcrumb";

export interface PageHeaderProps {
  readonly titulo: string;
  readonly subtitulo?: string;
  readonly acoes?: ReactNode;
  readonly breadcrumbs?: BreadcrumbItem[];
  readonly semBreadcrumb?: boolean;
  readonly className?: string;
  readonly eyebrow?: string;
  /**
   * Nivel do titulo. Use `2` quando a tela vive sob um layout de secao que ja
   * monta o `<h1>` — /financeiro, /conversas e /configuracoes fazem isso, e
   * antes disso a pagina saia com DOIS `<h1>` ("Financeiro" e "Recibos").
   * Em secao com abas a hierarquia correta e h1 = secao, h2 = aba atual.
   */
  readonly nivel?: 1 | 2;
}

export function PageHeader({
  titulo,
  subtitulo,
  acoes,
  breadcrumbs,
  semBreadcrumb = false,
  className,
  eyebrow,
  nivel = 1,
}: PageHeaderProps) {
  const Titulo = nivel === 2 ? 'h2' : 'h1';
  return (
    <header className={cn("cadencia-page-header min-w-0 w-full space-y-3", className)}>
      {!semBreadcrumb && (breadcrumbs ? <Breadcrumb itens={breadcrumbs} /> : <Breadcrumb />)}

      <div className="flex min-w-0 items-start justify-between gap-6 max-sm:flex-col max-sm:items-stretch">
        <div className="min-w-0 flex-1">
          {eyebrow ? <p className="cadencia-eyebrow mb-1.5">{eyebrow}</p> : null}
          <Titulo className={cn(
            "m-0 font-bold leading-[1.08] tracking-[-0.045em] text-text",
            nivel === 2 ? "text-[22px] sm:text-[25px]" : "text-[28px] sm:text-[31px]",
          )}>
            {titulo}
          </Titulo>
          {subtitulo && (
            <p className="m-0 mt-2 max-w-3xl text-sm leading-[1.65] text-text-muted">
              {subtitulo}
            </p>
          )}
        </div>

        {acoes && (
          <div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-center justify-end gap-2 pt-0.5 max-sm:w-full max-sm:justify-start max-sm:pt-0">
            {acoes}
          </div>
        )}
      </div>
    </header>
  );
}
