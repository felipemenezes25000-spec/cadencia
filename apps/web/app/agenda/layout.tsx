'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Printer } from '@phosphor-icons/react';
import { PageHeader } from '../../src/ui/PageHeader';
import { Tabs, TabsList, TabsTrigger } from '../../src/ui/Tabs';
import { Botao } from '../../src/ui/Botao';

const ABAS = [
  { value: 'agenda', rotulo: 'Agenda', href: '/agenda' },
  { value: 'lista-espera', rotulo: 'Lista de espera', href: '/agenda/lista-espera' },
] as const;

export default function LayoutAgenda({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const naImpressao = pathname === '/agenda/imprimir';
  if (naImpressao) return <>{children}</>;

  const abaAtiva = ABAS.find((a) => a.href === pathname)?.value ?? 'agenda';

  return (
    <div className="cadencia-page space-y-6 max-sm:p-4">
      <PageHeader
        titulo="Agenda"
        semBreadcrumb
        acoes={
          <Botao
            variante="secundario"
            tamanho="sm"
            iconeEsquerda={Printer}
            onClick={() => router.push('/agenda/imprimir')}
          >
            Imprimir
          </Botao>
        }
      />

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
