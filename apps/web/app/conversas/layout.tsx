'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { PageHeader } from '../../src/ui/PageHeader';
import { NavegacaoDeRotas } from '../../src/ui/NavegacaoDeRotas';

const ABAS = [
  { value: 'caixa', rotulo: 'Caixa', href: '/conversas' },
  { value: 'automacoes', rotulo: 'Automações', href: '/conversas/automacoes' },
  { value: 'templates', rotulo: 'Templates', href: '/conversas/templates' },
] as const;

export default function LayoutConversas({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  const abaAtiva = ABAS.find((a) => a.href === pathname)?.value ?? 'caixa';

  return (
    <div className="cadencia-page space-y-6 max-sm:p-4">
      <PageHeader titulo="Conversas" semBreadcrumb />

      <NavegacaoDeRotas rotulo="Seções de conversas" ativa={abaAtiva} itens={ABAS} />

      {children}
    </div>
  );
}
