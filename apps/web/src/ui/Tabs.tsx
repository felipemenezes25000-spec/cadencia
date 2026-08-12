"use client";

import type { ReactNode } from "react";
import * as RadixTabs from "@radix-ui/react-tabs";
import { cn } from "../lib/cn";

/* ── Re-export Root (não precisa de estilização) ────────────────────── */
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
        "flex w-fit max-w-full items-center gap-1 rounded-xl border border-line bg-surface-sunken/70 p-1 relative overflow-x-auto scrollbar-thin",
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
  /** Contador de notificação exibido como badge vermelho */
  readonly badge?: number | undefined;
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
        "relative inline-flex min-h-9 items-center rounded-lg px-3 py-1.5",
        "whitespace-nowrap text-sm font-medium text-text-muted",
        "transition-colors-fast",
        "hover:text-text",
        "data-[state=active]:bg-surface data-[state=active]:text-text data-[state=active]:shadow-elev-1",
        "outline-none focus-visible:ring-2 focus-visible:ring-accent",
        "cursor-pointer select-none",
        /* Indicador underline via pseudo-elemento */
        "data-[state=active]:ring-1 data-[state=active]:ring-line/70",
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
        "pt-5 outline-none",
        "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
        className,
      )}
    >
      {children}
    </RadixTabs.Content>
  );
}
