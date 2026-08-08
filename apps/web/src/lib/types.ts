/** Estado de uma operacao assincrona */
export type AsyncState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "success"; data: T };

/** Props comuns para estados de carregamento */
export interface LoadingState {
  isLoading: boolean;
}

/** Props comuns para estados de erro */
export interface ErrorState {
  error: Error | null;
  retry?: () => void;
}

/** Tamanhos padrao do design system */
export type Size = "sm" | "md" | "lg" | "xl";

/** Variantes semanticas */
export type Variant = "primario" | "secundario" | "fantasma" | "perigo";
