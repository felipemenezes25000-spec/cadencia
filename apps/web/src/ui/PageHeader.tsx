"use client";

import { type ReactNode } from "react";
import { motion } from "motion/react";
import { Sparkle } from "@phosphor-icons/react";
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
    <motion.header
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className={cn("relative pb-7", className)}
    >
      {!semBreadcrumb && (
        <div className="mb-4">
          {breadcrumbs ? <Breadcrumb itens={breadcrumbs} /> : <Breadcrumb />}
        </div>
      )}

      <div className="flex items-end justify-between gap-6 max-sm:flex-col max-sm:items-stretch">
        <div className="min-w-0">
          <div className="cadencia-eyebrow mb-2">
            <Sparkle size={11} weight="fill" aria-hidden />
            Cadencia workspace
          </div>
          <h1 className="m-0 max-w-4xl text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.02] tracking-[-0.052em] text-text text-balance">
            {titulo}
          </h1>
          {subtitulo && (
            <p className="m-0 mt-2 max-w-2xl text-[13px] leading-relaxed text-text-muted sm:text-sm">
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
    </motion.header>
  );
}
