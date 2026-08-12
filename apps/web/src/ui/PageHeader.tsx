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
  /** Pequeno contexto acima do titulo, quando ajuda a situar a tarefa. */
  readonly eyebrow?: string;
}

export function PageHeader({
  titulo,
  subtitulo,
  acoes,
  breadcrumbs,
  semBreadcrumb = false,
  className,
  eyebrow,
}: PageHeaderProps) {
  return (
    <header className={cn("space-y-3", className)}>
      {!semBreadcrumb && (breadcrumbs ? <Breadcrumb itens={breadcrumbs} /> : <Breadcrumb />)}

      <div className="flex min-w-0 items-end justify-between gap-6 max-sm:flex-col max-sm:items-stretch">
        <div className="min-w-0">
          {eyebrow ? <p className="cadencia-eyebrow mb-2">{eyebrow}</p> : null}
          <h1 className="m-0 text-[30px] font-bold leading-[1.08] tracking-[-0.04em] text-text sm:text-[32px]">
            {titulo}
          </h1>
          {subtitulo && (
            <p className="m-0 mt-2 max-w-3xl text-sm leading-relaxed text-text-muted">
              {subtitulo}
            </p>
          )}
        </div>

        {acoes && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 max-sm:w-full max-sm:justify-start">
            {acoes}
          </div>
        )}
      </div>
    </header>
  );
}
