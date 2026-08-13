'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { PageHeader } from '../../src/ui/PageHeader';
import { NavegacaoDeRotas } from '../../src/ui/NavegacaoDeRotas';

const ABAS = [
  { value: 'indicadores', rotulo: 'Indicadores', href: '/desempenho' },
  { value: 'nps', rotulo: 'NPS', href: '/desempenho/nps' },
] as const;

export default function LayoutDesempenho({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  const abaAtiva = ABAS.find((a) => a.href === pathname)?.value ?? 'indicadores';

  return (
    <div className="cadencia-page space-y-6 max-sm:p-4">
      <PageHeader titulo="Desempenho" semBreadcrumb />

      <NavegacaoDeRotas rotulo="Seções de desempenho" ativa={abaAtiva} itens={ABAS} />

      {children}
    </div>
  );
}
