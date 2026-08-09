import { Component, type ReactNode, type ErrorInfo } from "react";
import { Warning, ArrowCounterClockwise, Heartbeat } from "@phosphor-icons/react";
import { Icone } from "./Icone";
import { Botao } from "./Botao";

interface ErrorBoundaryProps { children: ReactNode; fallback?: ReactNode; onError?: (error: Error, errorInfo: ErrorInfo) => void; }
interface ErrorBoundaryState { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error: Error): ErrorBoundaryState { return { hasError: true, error }; }
  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void { this.props.onError?.(error, errorInfo); console.error("ErrorBoundary caught:", error, errorInfo); }
  handleRetry = (): void => { this.setState({ hasError: false, error: null }); };

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="cadencia-page flex min-h-[72vh] items-center justify-center p-5 text-center">
        <div className="cadencia-panel cadencia-panel-hero relative w-full max-w-xl overflow-hidden p-7 sm:p-10">
          <div aria-hidden className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-danger/8 blur-3xl" />
          <div className="relative mx-auto mb-5 grid h-14 w-14 place-items-center rounded-[18px] border border-danger/15 bg-danger-soft text-danger shadow-elev-2"><Icone icon={Warning} size="xl" /></div>
          <span className="cadencia-eyebrow"><Heartbeat size={11} weight="fill" /> proteção de sessão</span>
          <h2 className="m-0 mt-2 text-xl font-semibold tracking-[-.035em] text-text">Algo deu errado</h2>
          <p className="mx-auto mb-6 mt-2 max-w-md text-sm leading-relaxed text-text-muted">Ocorreu um erro inesperado. Tente recarregar a pagina ou entre em contato com o suporte se o problema persistir.</p>
          {process.env.NODE_ENV === "development" && this.state.error && <pre className="mb-6 max-h-40 overflow-auto rounded-xl border border-danger/15 bg-danger-soft/45 p-4 text-left font-mono text-[11px] text-danger">{this.state.error.message}{"\n"}{this.state.error.stack}</pre>}
          <div className="flex justify-center"><Botao variante="primario" iconeEsquerda={ArrowCounterClockwise} onClick={this.handleRetry}>Tentar novamente</Botao></div>
        </div>
      </div>
    );
  }
}
