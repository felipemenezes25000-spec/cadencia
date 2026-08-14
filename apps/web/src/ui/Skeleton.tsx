"use client";

import { cn } from "../lib/cn";

interface SkeletonProps {
  /** Variante visual */
  readonly variant?: "text" | "avatar" | "card" | "table-row";
  /** Largura customizada (CSS value) */
  readonly width?: string;
  /** Altura customizada (CSS value) */
  readonly height?: string;
  /** Número de linhas (para variant="text") */
  readonly lines?: number;
  /** Label de acessibilidade customizado */
  readonly ariaLabel?: string;
  /**
   * Não anuncia nada: sem `role="status"`, sem `aria-label`, marcado como
   * `aria-hidden`.
   *
   * Cada Skeleton é uma região live por padrão. Numa tela de carregamento com
   * uma dúzia deles, o leitor de tela repete "Carregando..." uma dúzia de
   * vezes. Quem compõe várias barras deve declarar UMA região no contêiner e
   * passar `decorativo` nas barras — é o que SkeletonDePagina faz.
   */
  readonly decorativo?: boolean;
  /** Classes adicionais */
  readonly className?: string;
}

const shimmerClasses =
  "bg-[linear-gradient(90deg,var(--line)_25%,var(--surface)_50%,var(--line)_75%)] [background-size:200%_100%] animate-[skeleton-shimmer_1.5s_ease-in-out_infinite]";

const variantClasses: Record<NonNullable<SkeletonProps["variant"]>, string> = {
  text: "w-full h-4 rounded-md",
  avatar: "h-10 w-10 shrink-0 rounded-full",
  card: "w-full h-[120px] rounded-md",
  "table-row": "h-12 rounded-md",
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
  decorativo = false,
  className,
}: SkeletonProps) {
  // Estilos dinâmicos apenas quando o usuário fornece width/height custom
  const dynamicStyle: React.CSSProperties | undefined =
    width || height ? { ...(width ? { width } : {}), ...(height ? { height } : {}) } : undefined;

  /* Ou anuncia, ou some da árvore — nunca os dois pela metade. */
  const anuncio = decorativo
    ? ({ "aria-hidden": true } as const)
    : ({ role: "status", "aria-busy": true, "aria-label": ariaLabel } as const);

  // --- Variante text com múltiplas linhas ---
  if (variant === "text" && lines > 1) {
    return (
      <div {...anuncio} className={cn("flex flex-col gap-2", className)}>
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
        {...anuncio}
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
      {...anuncio}
      className={cn(shimmerClasses, variantClasses[variant], className)}
      style={dynamicStyle}
    />
  );
}
