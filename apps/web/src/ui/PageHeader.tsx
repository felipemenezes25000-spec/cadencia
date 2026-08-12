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
    <header className={cn("space-y-2", className)}>
      {!semBreadcrumb &&
        (breadcrumbs ? <Breadcrumb itens={breadcrumbs} /> : <Breadcrumb />)}

      <div className="flex min-w-0 items-start justify-between gap-5 max-sm:flex-col max-sm:items-stretch">
        <div className="min-w-0">
          <h1 className="m-0 text-[28px] font-bold leading-tight tracking-[-0.03em] text-text">
            {titulo}
          </h1>
          {subtitulo && (
            <p className="m-0 mt-1 max-w-2xl text-sm leading-relaxed text-text-muted">
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
