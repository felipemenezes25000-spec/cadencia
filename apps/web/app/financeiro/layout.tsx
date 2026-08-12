'use client';

import type { ReactNode } from 'react';
import { FinanceiroLayout } from '../../src/telas/FinanceiroLayout';

/**
 * O layout do Next segura as abas, e não cada página: sem isso a faixa de
 * navegação remonta a cada troca de aba e o foco do teclado se perde no meio
 * da navegação — que é exatamente onde a recepção usa o produto mais rápido.
 */
export default function LayoutFinanceiro({ children }: { children: ReactNode }) {
  return <FinanceiroLayout>{children}</FinanceiroLayout>;
}
