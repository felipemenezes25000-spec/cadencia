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
    <div className={cn("space-y-3 pb-7", className)}>
      {!semBreadcrumb &&
        (breadcrumbs ? <Breadcrumb itens={breadcrumbs} /> : <Breadcrumb />)}

      <div className="flex items-end justify-between gap-5 max-sm:flex-col max-sm:items-stretch">
        <div className="min-w-0 space-y-1.5">
          <h1 className="m-0 text-[clamp(1.55rem,2.4vw,2rem)] font-semibold leading-[1.12] tracking-[-0.035em] text-text">
            {titulo}
          </h1>
          {subtitulo && (
            <p className="m-0 max-w-2xl text-[13px] leading-relaxed text-text-muted sm:text-sm">
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
    </div>
  );
}
