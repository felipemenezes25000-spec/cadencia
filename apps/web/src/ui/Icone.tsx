import { cn } from "../lib/cn";
import type { Icon as PhosphorIcon, IconWeight } from "@phosphor-icons/react";

/** Tamanhos padrao em pixels */
const TAMANHOS = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;

type TamanhoIcone = keyof typeof TAMANHOS;

interface IconeProps {
  /** O componente Phosphor a renderizar */
  readonly icon: PhosphorIcon;
  /** Tamanho padronizado */
  readonly size?: TamanhoIcone;
  /** Peso do icone Phosphor */
  readonly weight?: IconWeight;
  /** Classes adicionais Tailwind */
  readonly className?: string;
  /** Acessibilidade: texto alternativo. Se omitido, icone e decorativo (aria-hidden) */
  readonly label?: string;
}

export function Icone({
  icon: Icon,
  size = "md",
  weight = "regular",
  className,
  label,
}: IconeProps) {
  return (
    <Icon
      size={TAMANHOS[size]}
      weight={weight}
      className={cn("shrink-0", className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
    />
  );
}
