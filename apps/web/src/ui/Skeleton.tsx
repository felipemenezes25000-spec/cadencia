"use client";

import { cn } from "../lib/cn";

interface SkeletonProps {
  /** Variante visual */
  readonly variant?: "text" | "avatar" | "card" | "table-row";
  /** Largura customizada (CSS value) */
  readonly width?: string;
  /** Altura customizada (CSS value) */
  readonly height?: string;
  /** Numero de linhas (para variant="text") */
  readonly lines?: number;
  /** Label de acessibilidade customizado */
  readonly ariaLabel?: string;
  /** Classes adicionais */
  readonly className?: string;
}

const shimmerClasses =
  "relative overflow-hidden bg-[linear-gradient(105deg,var(--surface-sunken)_18%,var(--surface-raised)_42%,var(--surface-sunken)_66%)] [background-size:220%_100%] animate-[skeleton-shimmer_1.35s_ease-in-out_infinite]";

const variantClasses: Record<NonNullable<SkeletonProps["variant"]>, string> = {
  text: "w-full h-4 rounded-md",
  avatar: "h-10 w-10 shrink-0 rounded-full",
  card: "w-full h-[120px] rounded-[20px]",
  "table-row": "h-12 rounded-xl",
};

/**
 * Barra de shimmer individual reutilizada internamente.
 */
function ShimmerBar({
  className,
  style,
}: {
  readonly className?: string;
  readonly style?: React.CSSProperties | undefined;
}) {
  return <div className={cn(shimmerClasses, className)} style={style} />;
}

/**
 * Skeleton -- primitiva de loading para estados de carregamento.
 *
 * @example
 * ```tsx
 * <Skeleton variant="avatar" />
 * <Skeleton variant="text" lines={3} />
 * <Skeleton variant="card" />
 * ```
 */
export function Skeleton({
  variant = "text",
  width,
  height,
  lines = 1,
  ariaLabel = "Carregando...",
  className,
}: SkeletonProps) {
  // Estilos dinamicos apenas quando o usuario fornece width/height custom
  const dynamicStyle: React.CSSProperties | undefined =
    width || height ? { ...(width ? { width } : {}), ...(height ? { height } : {}) } : undefined;

  // --- Variante text com multiplas linhas ---
  if (variant === "text" && lines > 1) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={ariaLabel}
        className={cn("flex flex-col gap-2", className)}
      >
        {Array.from({ length: lines }, (_, i) => (
          <ShimmerBar
            key={i}
            className={cn("h-4 rounded-md", i === lines - 1 ? "w-3/4" : "w-full")}
          />
        ))}
      </div>
    );
  }

  // --- Variante table-row: 3 pseudo-colunas ---
  if (variant === "table-row") {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={ariaLabel}
        className={cn("flex w-full items-stretch gap-[2px]", className)}
        style={dynamicStyle}
      >
        <ShimmerBar
          className={cn("flex-[2] rounded-l-md rounded-r-none", variantClasses["table-row"])}
          style={height ? { height } : undefined}
        />
        <ShimmerBar
          className={cn("flex-[3] rounded-none", variantClasses["table-row"])}
          style={height ? { height } : undefined}
        />
        <ShimmerBar
          className={cn("flex-[1] rounded-l-none rounded-r-md", variantClasses["table-row"])}
          style={height ? { height } : undefined}
        />
      </div>
    );
  }

  // --- Variantes simples: text (1 linha), avatar, card ---
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={ariaLabel}
      className={cn(shimmerClasses, variantClasses[variant], className)}
      style={dynamicStyle}
    />
  );
}
