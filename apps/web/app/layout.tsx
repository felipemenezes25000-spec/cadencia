import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';
import { ErrorBoundary } from '../src/ui/ErrorBoundary';
import { ConnectivityStatus } from '../src/ui/ConnectivityStatus';
import { AppShell } from '../src/components/shell/AppShell';

export const metadata: Metadata = {
  title: {
    default: 'Cadencia',
    template: '%s | Cadencia',
  },
  description: 'Sistema de gestao clinica e prontuario eletronico',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        {/* Link de acessibilidade: pular para conteudo principal */}
        <a
          href="#conteudo-principal"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-[var(--r-md)] focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-on"
        >
          Pular para o conteudo principal
        </a>

        <Providers>
          <ConnectivityStatus />
          <AppShell>
            <ErrorBoundary>{children}</ErrorBoundary>
          </AppShell>
        </Providers>
      </body>
    </html>
  );
}
