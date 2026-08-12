import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Mono, IBM_Plex_Serif } from 'next/font/google';
import './globals.css';
import { cn } from '../src/lib/cn';
import { Providers } from './providers';
import { BarraDeNavegacao } from '../src/ui/BarraDeNavegacao';
import { ErrorBoundary } from '../src/ui/ErrorBoundary';
import { ConnectivityStatus } from '../src/ui/ConnectivityStatus';

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

const plexSerif = IBM_Plex_Serif({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-doc',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Cadencia',
    template: '%s | Cadencia',
  },
  description: 'Sistema de gestão clínica e prontuário eletrônico',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={cn(plexSans.variable, plexMono.variable, plexSerif.variable)}
      suppressHydrationWarning
    >
      <body className="bg-bg text-text font-sans antialiased">
        {/* Link de acessibilidade: pular para conteúdo principal */}
        <a
          href="#conteudo-principal"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-[var(--r-md)] focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-on"
        >
          Pular para o conteúdo principal
        </a>

        <Providers>
          <ConnectivityStatus />
          <div className="flex min-h-screen">
            <BarraDeNavegacao />

            <main
              id="conteudo-principal"
              className="relative min-h-screen flex-1 min-w-0 ml-[var(--nav-width,0px)] max-md:ml-0 pb-[calc(var(--nav-height)+8px)] md:pb-0 transition-[margin-left] duration-200 ease-[var(--ease-in-out)]"
            >
              <ErrorBoundary>
                {children}
              </ErrorBoundary>
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
