import { Component, type ReactNode, type ErrorInfo } from "react";
import { Warning, ArrowCounterClockwise } from "@phosphor-icons/react";
import { Icone } from "./Icone";
import { Botao } from "./Botao";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Componente de fallback customizado */
  fallback?: ReactNode;
  /** Callback quando um erro ocorre */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);
    // Log to error reporting service
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          <div className="rounded-full bg-danger/10 p-4 mb-4">
            <Icone icon={Warning} size="xl" className="text-danger" />
          </div>
          <h2 className="text-lg font-semibold text-text mb-2">
            Algo deu errado
          </h2>
          <p className="text-sm text-text-muted max-w-md mb-6">
            Ocorreu um erro inesperado. Tente recarregar a pagina ou entre em contato com o suporte
            se o problema persistir.
          </p>
          {process.env.NODE_ENV === "development" && this.state.error && (
            <pre className="mb-6 max-w-lg overflow-auto rounded-md bg-surface-raised p-4
                            text-left text-xs font-mono text-danger">
              {this.state.error.message}
              {"\n"}
              {this.state.error.stack}
            </pre>
          )}
          <Botao
            variante="primario"
            iconeEsquerda={ArrowCounterClockwise}
            onClick={this.handleRetry}
          >
            Tentar novamente
          </Botao>
        </div>
      );
    }

    return this.props.children;
  }
}
