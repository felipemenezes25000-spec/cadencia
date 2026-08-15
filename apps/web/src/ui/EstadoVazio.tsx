import type { ReactNode } from "react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { Icone } from "./Icone";
import { cn } from "../lib/cn";

interface EstadoVazioProps {
  /** Ícone ilustrativo */
  icone: PhosphorIcon;
  /** Título principal */
  titulo: string;
  /** Descrição explicativa */
  descricao?: string;
  /** Ação principal (botão) */
  acao?: ReactNode;
  /** Tamanho compacto (para uso dentro de seções) */
  compacto?: boolean;
  /** Classes adicionais */
  className?: string;
}

export function EstadoVazio({
  icone,
  titulo,
  descricao,
  acao,
  compacto = false,
  className,
}: EstadoVazioProps) {
  return (
    <div className={cn(
      "cadencia-empty-state flex flex-col items-center justify-center rounded-[16px] border border-dashed border-line bg-[radial-gradient(circle_at_50%_0%,var(--brand-soft),transparent_17rem),var(--surface-subtle)] text-center",
      compacto ? "px-4 py-7" : "px-6 py-12",
      className
    )}>
      <div className={cn(
        "cadencia-empty-icon mb-4 grid place-items-center rounded-[14px] border border-line bg-surface text-accent shadow-elev-1",
        compacto ? "size-10" : "size-12"
      )}>
        <Icone
          icon={icone}
          size={compacto ? "md" : "lg"}
          className="text-text-muted"
        />
      </div>
      <p className={cn(
        "font-semibold tracking-[-0.015em] text-text",
        compacto ? "text-sm" : "text-base"
      )}>
        {titulo}
      </p>
      {descricao && (
        <p className={cn(
          "text-text-muted mt-1 max-w-sm",
          compacto ? "text-xs" : "text-sm"
        )}>
          {descricao}
        </p>
      )}
      {acao && (
        <div className="mt-4">
          {acao}
        </div>
      )}
    </div>
  );
}
