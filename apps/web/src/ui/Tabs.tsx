"use client";

import type { ReactNode } from "react";
import * as RadixTabs from "@radix-ui/react-tabs";
import { cn } from "../lib/cn";

/* ── Re-export Root (nao precisa de estilizacao) ────────────────────── */
export const Tabs = RadixTabs.Root;

/* ── TabsList ───────────────────────────────────────────────────────── */
export interface TabsListProps {
  readonly children: ReactNode;
  readonly className?: string;
}

export function TabsList({ children, className }: TabsListProps) {
  return (
    <RadixTabs.List
      className={cn(
        "flex items-center gap-1 border-b border-line relative",
        className,
      )}
    >
      {children}
    </RadixTabs.List>
  );
}

/* ── TabsTrigger ────────────────────────────────────────────────────── */
export interface TabsTriggerProps {
  readonly children: ReactNode;
  readonly value: string;
  /** Contador de notificacao exibido como badge vermelho */
  readonly badge?: number;
  readonly className?: string;
}

export function TabsTrigger({
  children,
  value,
  badge,
  className,
}: TabsTriggerProps) {
  return (
    <RadixTabs.Trigger
      value={value}
      className={cn(
        "relative inline-flex items-center px-3 py-2",
        "text-sm font-medium text-text-muted",
        "transition-colors-fast",
        "hover:text-text",
        "data-[state=active]:text-accent",
        "outline-none focus-visible:ring-2 focus-visible:ring-accent",
        "cursor-pointer select-none",
        /* Indicador underline via pseudo-elemento */
        "after:absolute after:bottom-[-1px] after:left-0 after:right-0",
        "after:h-[2px] after:bg-transparent",
        "after:transition-colors after:duration-150 after:ease-in-out",
        "data-[state=active]:after:bg-accent",
        className,
      )}
    >
      {children}
      {badge != null && badge > 0 && (
        <span
          className={cn(
            "ml-1.5 inline-flex items-center justify-center",
            "min-w-[18px] h-[18px]",
            "rounded-full bg-danger text-white",
            "text-[10px] font-bold px-1",
          )}
        >
          {badge}
        </span>
      )}
    </RadixTabs.Trigger>
  );
}

/* ── TabsContent ────────────────────────────────────────────────────── */
export interface TabsContentProps {
  readonly children: ReactNode;
  readonly value: string;
  readonly className?: string;
}

export function TabsContent({ children, value, className }: TabsContentProps) {
  return (
    <RadixTabs.Content
      value={value}
      className={cn(
        "pt-4 outline-none",
        "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
        className,
      )}
    >
      {children}
    </RadixTabs.Content>
  );
}
