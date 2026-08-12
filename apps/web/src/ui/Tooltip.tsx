"use client";

import type { ReactNode } from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { cn } from "../lib/cn";

export interface TooltipProps {
  /** Conteúdo do tooltip */
  readonly conteudo: string;
  /** Posição relativa ao trigger */
  readonly lado?: "top" | "bottom" | "left" | "right";
  /** Delay em ms antes de mostrar */
  readonly delay?: number;
  /** Elemento que ativa o tooltip */
  readonly children: ReactNode;
  /** Classes adicionais para o conteúdo */
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
            "z-50 rounded-lg border border-white/10 px-2.5 py-1.5",
            "text-[length:var(--fs-12)] leading-[var(--lh-ui)]",
            "bg-[oklch(20%_0.035_264)] text-white",
            "shadow-elev-2",
            "animate-[scaleIn_150ms_ease]",
            "select-none",
            className,
          )}
        >
          {conteudo}
          <RadixTooltip.Arrow className="fill-[oklch(20%_0.035_264)]" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
