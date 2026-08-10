'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { PageHeader } from '../../src/ui/PageHeader';
import { Tabs, TabsList, TabsTrigger } from '../../src/ui/Tabs';

const ABAS = [
  { value: 'caixa', rotulo: 'Caixa', href: '/conversas' },
  { value: 'automacoes', rotulo: 'Automacoes', href: '/conversas/automacoes' },
  { value: 'templates', rotulo: 'Templates', href: '/conversas/templates' },
] as const;

export default function LayoutConversas({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const abaAtiva = ABAS.find((a) => a.href === pathname)?.value ?? 'caixa';

  return (
    <div className="cadencia-page space-y-6 max-sm:p-4">
      <PageHeader titulo="Conversas" semBreadcrumb />

      <Tabs
        value={abaAtiva}
        onValueChange={(v: string) => {
          const aba = ABAS.find((a) => a.value === v);
          if (aba) router.push(aba.href);
        }}
      >
        <TabsList>
          {ABAS.map((aba) => (
            <TabsTrigger key={aba.value} value={aba.value}>
              {aba.rotulo}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {children}
    </div>
  );
}
