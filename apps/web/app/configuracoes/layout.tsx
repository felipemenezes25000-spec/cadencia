'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '../../src/lib/cn';
import { PageHeader } from '../../src/ui/PageHeader';
import { Tabs, TabsList, TabsTrigger } from '../../src/ui/Tabs';

const ABAS = [
  { value: 'clinica', rotulo: 'Clinica', href: '/configuracoes' },
  { value: 'equipe', rotulo: 'Equipe', href: '/configuracoes/equipe' },
  { value: 'permissoes', rotulo: 'Permissoes', href: '/configuracoes/permissoes' },
  { value: 'procedimentos', rotulo: 'Procedimentos', href: '/configuracoes/procedimentos' },
  { value: 'prontuario', rotulo: 'Prontuario', href: '/configuracoes/prontuario' },
  { value: 'auditoria', rotulo: 'Auditoria', href: '/configuracoes/auditoria' },
  { value: 'catalogos', rotulo: 'Catalogos', href: '/catalogos' },
  { value: 'perfil', rotulo: 'Meu perfil', href: '/configuracoes/perfil' },
] as const;

export default function LayoutConfiguracoes({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const abaAtiva = ABAS.find((a) => a.href === pathname)?.value ?? 'clinica';
  return (
    <div className="cadencia-page space-y-6 max-sm:p-4">
      <PageHeader titulo="Configuracoes" semBreadcrumb />
      <Tabs value={abaAtiva} onValueChange={(v: string) => {
        const aba = ABAS.find((a) => a.value === v);
        if (aba) router.push(aba.href);
      }}>
        <div className={cn('overflow-x-auto scrollbar-thin', '-mx-1 px-1')}>
          <TabsList className="min-w-max">
            {ABAS.map((aba) => (
              <TabsTrigger key={aba.value} value={aba.value}>{aba.rotulo}</TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>
      {children}
    </div>
  );
}
