"use client";

import type { ReactNode } from "react";
import * as RadixTabs from "@radix-ui/react-tabs";
import { cn } from "../lib/cn";

export const Tabs = RadixTabs.Root;

export interface TabsListProps {
  readonly children: ReactNode;
  readonly className?: string;
}

export function TabsList({ children, className }: TabsListProps) {
  return (
    <RadixTabs.List
      className={cn(
        "relative flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-[14px] border border-line/75",
        "bg-surface-sunken/75 p-1 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--surface)_84%,white)] backdrop-blur-xl scrollbar-thin",
        className,
      )}
    >
      {children}
    </RadixTabs.List>
  );
}

export interface TabsTriggerProps {
  readonly children: ReactNode;
  readonly value: string;
  readonly badge?: number | undefined;
  readonly className?: string;
}

export function TabsTrigger({ children, value, badge, className }: TabsTriggerProps) {
  return (
    <RadixTabs.Trigger
      value={value}
      className={cn(
        "group relative inline-flex min-h-10 items-center justify-center gap-1.5 overflow-hidden rounded-[10px] px-3.5 py-2",
        "whitespace-nowrap text-[13px] font-semibold tracking-[-.01em] text-text-muted outline-none select-none",
        "transition-[color,background-color,box-shadow,transform] duration-[var(--dur-2)] ease-[var(--ease-out)]",
        "hover:bg-surface/70 hover:text-text active:scale-[.985]",
        "data-[state=active]:bg-surface data-[state=active]:text-text data-[state=active]:shadow-elev-1 data-[state=active]:ring-1 data-[state=active]:ring-line/70",
        "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute inset-x-3 bottom-0 h-[2px] origin-center scale-x-0 rounded-full bg-[var(--aurora)] opacity-0 transition-all duration-[var(--dur-2)] group-data-[state=active]:scale-x-100 group-data-[state=active]:opacity-100"
      />
      <span className="relative z-[1] inline-flex items-center gap-1.5">{children}</span>
      {badge != null && badge > 0 && (
        <span className="relative z-[1] inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white shadow-[0_3px_10px_color-mix(in_oklab,var(--danger)_24%,transparent)]">
          {badge}
        </span>
      )}
    </RadixTabs.Trigger>
  );
}

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
        "pt-5 outline-none data-[state=active]:animate-[cadencia-enter_.28s_var(--ease-out)_both]",
        "focus-visible:rounded-2xl focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
        className,
      )}
    >
      {children}
    </RadixTabs.Content>
  );
}
