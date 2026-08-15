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
        "cadencia-tabs-list flex min-w-0 w-full max-w-full items-center gap-1 overflow-x-auto rounded-[14px] border border-line bg-surface-subtle/78 p-1.5 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.92),0_5px_16px_rgb(8_46_48_/_0.035)] backdrop-blur-sm scrollbar-thin sm:w-fit",
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
        "cadencia-tab-trigger inline-flex min-h-9 items-center rounded-[10px] px-3.5 py-1.5",
        /* 36px viram 44px no toque. Atinge toda barra de abas do produto. */
        "max-md:min-h-11",
        "whitespace-nowrap text-sm font-medium text-text-muted outline-none",
        "transition-[background-color,color,box-shadow,transform] duration-150",
        "hover:bg-surface hover:text-text",
        "data-[state=active]:bg-surface data-[state=active]:font-bold data-[state=active]:text-accent data-[state=active]:shadow-[0_5px_14px_rgb(8_46_48_/_0.07),inset_0_1px_0_rgb(255_255_255_/.95)]",
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
