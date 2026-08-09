import type { ReactNode } from "react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { Sparkle } from "@phosphor-icons/react";
import { Icone } from "./Icone";
import { cn } from "../lib/cn";

interface EstadoVazioProps {
  icone: PhosphorIcon;
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
  compacto?: boolean;
  className?: string;
}

export function EstadoVazio({ icone, titulo, descricao, acao, compacto = false, className }: EstadoVazioProps) {
  return (
    <div className={cn(
      "relative isolate flex flex-col items-center justify-center overflow-hidden rounded-[22px] border border-dashed border-line bg-surface/72 text-center shadow-[inset_0_1px_0_color-mix(in_oklab,var(--surface)_84%,white)]",
      compacto ? "px-4 py-8" : "px-6 py-14 sm:py-16",
      className,
    )}>
      <div aria-hidden className="pointer-events-none absolute -top-24 h-48 w-48 rounded-full bg-accent/8 blur-3xl" />
      <div className={cn("relative mb-4 grid place-items-center rounded-[18px] border border-line/80 bg-surface-raised shadow-elev-2", compacto ? "h-11 w-11" : "h-14 w-14")}>
        <span aria-hidden className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-[var(--aurora)] text-white shadow-elev-1"><Sparkle size={9} weight="fill" /></span>
        <Icone icon={icone} size={compacto ? "lg" : "xl"} className="text-accent" />
      </div>
      <p className={cn("relative m-0 font-semibold tracking-[-.02em] text-text", compacto ? "text-sm" : "text-base")}>{titulo}</p>
      {descricao && <p className={cn("relative mt-1.5 max-w-sm text-text-muted", compacto ? "text-xs" : "text-sm leading-relaxed")}>{descricao}</p>}
      {acao && <div className="relative mt-5">{acao}</div>}
    </div>
  );
}
