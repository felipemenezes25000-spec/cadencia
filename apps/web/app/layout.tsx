import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';
import { BarraDeNavegacao } from '../src/ui/BarraDeNavegacao';

export const metadata = { title: 'Cadencia', description: 'Prontuario e gestao para clinicas' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <Providers>
          <BarraDeNavegacao />
          <main id="conteudo">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
