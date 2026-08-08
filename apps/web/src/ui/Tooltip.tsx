"use client";

import type { ReactNode } from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { cn } from "../lib/cn";

export interface TooltipProps {
  /** Conteudo do tooltip */
  readonly conteudo: string;
  /** Posicao relativa ao trigger */
  readonly lado?: "top" | "bottom" | "left" | "right";
  /** Delay em ms antes de mostrar */
  readonly delay?: number;
  /** Elemento que ativa o tooltip */
  readonly children: ReactNode;
  /** Classes adicionais para o conteudo */
  readonly className?: string;
}

export function Tooltip({
  conteudo,
  lado = "top",
  delay = 300,
  children,
  className,
}: TooltipProps) {
  return (
    <RadixTooltip.Root delayDuration={delay}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={lado}
          sideOffset={4}
          className={cn(
            "z-50 rounded-[var(--r-md)] px-2.5 py-1.5",
            "text-[length:var(--fs-12)] leading-[var(--lh-ui)]",
            "bg-text text-bg",
            "shadow-elev-1",
            "animate-[scaleIn_150ms_ease]",
            "select-none",
            className,
          )}
        >
          {conteudo}
          <RadixTooltip.Arrow className="fill-text" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
