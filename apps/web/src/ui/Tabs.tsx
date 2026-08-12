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
        "flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-[10px] border border-line bg-surface-subtle p-0.5 scrollbar-thin",
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
        "inline-flex min-h-9 items-center rounded-lg px-3 py-1.5",
        "whitespace-nowrap text-sm font-medium text-text-muted outline-none",
        "transition-[background-color,color] duration-150",
        "hover:bg-surface hover:text-text",
        "data-[state=active]:bg-surface data-[state=active]:font-semibold data-[state=active]:text-accent",
        "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1",
        "cursor-pointer select-none",
        className,
      )}
    >
      {children}
      {badge != null && badge > 0 && (
        <span className="ml-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
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
        "pt-5 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
        className,
      )}
    >
      {children}
    </RadixTabs.Content>
  );
}