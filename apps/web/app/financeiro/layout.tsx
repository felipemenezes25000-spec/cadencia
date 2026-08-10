'use client';

import type { ReactNode } from 'react';
import { FinanceiroLayout } from '../../src/telas/FinanceiroLayout';

/**
 * O layout do Next segura as abas, e nao cada pagina: sem isso a faixa de
 * navegacao remonta a cada troca de aba e o foco do teclado se perde no meio
 * da navegacao — que e exatamente onde a recepcao usa o produto mais rapido.
 */
export default function LayoutFinanceiro({ children }: { children: ReactNode }) {
  return <FinanceiroLayout>{children}</FinanceiroLayout>;
}
