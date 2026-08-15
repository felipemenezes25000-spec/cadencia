import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import './luminous.css';
import { Providers } from './providers';
import { ErrorBoundary } from '../src/ui/ErrorBoundary';
import { ConnectivityStatus } from '../src/ui/ConnectivityStatus';
import { AppShell } from '../src/components/shell/AppShell';

/**
 * Inter, versao variavel, servida do proprio dominio.
 *
 * O CSS declarava `Inter` no stack desde sempre, mas nada carregava o arquivo:
 * quem nao tivesse a fonte instalada localmente via Segoe UI. O design inteiro
 * estava sendo julgado numa tipografia que nao e a escolhida.
 *
 * E `local` em vez de `next/font/google` de proposito:
 *   - o build nao depende de rede (o de `google` baixa em build time e falha
 *     em runner sem saida para fonts.gstatic.com);
 *   - nenhum request sai para CDN de terceiro em producao. Google Fonts entrega
 *     a fonte a partir do IP do paciente, o que e transferencia de dado pessoal
 *     a terceiro sem base legal — num produto que faz LGPD isso nao passa.
 *
 * Arquivo: subset latin (U+0000-00FF cobre todo o portugues), eixo de peso
 * 400-700 num unico woff2 de 48KB. Inter e SIL Open Font License 1.1.
 */
const inter = localFont({
  src: './fonts/inter-latin-var.woff2',
  weight: '400 700',
  style: 'normal',
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: {
    default: 'Cadência',
    template: '%s | Cadência',
  },
  description: 'Sistema de gestão clínica e prontuário eletrônico',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  /* Sem `cover`, `env(safe-area-inset-*)` resolve 0 e a regra de safe area do
     dock (premium.css) nunca dispara. Com `cover`, o layout vai de borda a
     borda e QUEM insere o respiro e o CSS — por isso isto anda junto com o
     padding do dock e o `pt-[env(safe-area-inset-top)]` da TopBar.
     `maximumScale`/`userScalable` seguem ausentes de proposito: desativar
     pinch-zoom quebra acessibilidade. */
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable} suppressHydrationWarning>
      <body>
        {/* Link de acessibilidade: pular para conteudo principal */}
        <a
          href="#conteudo-principal"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-[var(--r-md)] focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-on"
        >
          Pular para o conteúdo principal
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
