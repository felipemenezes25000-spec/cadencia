import type { ReactNode } from "react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { Icone } from "./Icone";
import { cn } from "../lib/cn";

interface EstadoVazioProps {
  /** Icone ilustrativo */
  icone: PhosphorIcon;
  /** Titulo principal */
  titulo: string;
  /** Descricao explicativa */
  descricao?: string;
  /** Acao principal (botao) */
  acao?: ReactNode;
  /** Tamanho compacto (para uso dentro de secoes) */
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
      "flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface/60 text-center",
      compacto ? "px-4 py-8" : "px-6 py-16",
      className
    )}>
      <div className={cn(
        "mb-4 rounded-2xl border border-line bg-surface-raised shadow-elev-1",
        compacto ? "p-2.5" : "p-4"
      )}>
        <Icone
          icon={icone}
          size={compacto ? "lg" : "xl"}
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
