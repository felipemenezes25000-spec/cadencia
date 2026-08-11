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
        "relative flex w-full max-w-full items-center gap-1 overflow-x-auto border-b border-line scrollbar-thin",
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
        "relative inline-flex min-h-10 items-center px-3 py-1.5",
        "whitespace-nowrap text-sm font-medium text-text-muted",
        "transition-colors-fast",
        "hover:bg-surface-subtle hover:text-text",
        "data-[state=active]:font-semibold data-[state=active]:text-accent",
        "after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:scale-x-0 after:rounded-full after:bg-accent after:transition-transform",
        "data-[state=active]:after:scale-x-100",
        "rounded-t-lg outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
        "cursor-pointer select-none",
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
