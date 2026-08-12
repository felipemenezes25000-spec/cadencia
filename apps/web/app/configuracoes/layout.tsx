'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  GearSix,
  NotePencil,
  ShieldCheck,
  Stethoscope,
  Table,
  UserCircleGear,
  Users,
} from '@phosphor-icons/react';
import { cn } from '../../src/lib/cn';
import { PageHeader } from '../../src/ui/PageHeader';

const ABAS = [
  { value: 'clinica', rotulo: 'Clínica', descricao: 'Unidades e dados cadastrais', href: '/configuracoes', icone: Stethoscope },
  { value: 'equipe', rotulo: 'Equipe', descricao: 'Pessoas e acessos', href: '/configuracoes/equipe', icone: Users },
  { value: 'permissoes', rotulo: 'Permissões', descricao: 'Papéis e segurança', href: '/configuracoes/permissoes', icone: ShieldCheck },
  { value: 'procedimentos', rotulo: 'Procedimentos', descricao: 'Catálogo da unidade', href: '/configuracoes/procedimentos', icone: Table },
  { value: 'prontuario', rotulo: 'Prontuário', descricao: 'Estrutura clínica', href: '/configuracoes/prontuario', icone: NotePencil },
  { value: 'auditoria', rotulo: 'Auditoria', descricao: 'Trilha de alterações', href: '/configuracoes/auditoria', icone: ShieldCheck },
  { value: 'exportar', rotulo: 'Exportar', descricao: 'Portabilidade de dados', href: '/configuracoes/exportar', icone: Table },
  { value: 'catalogos', rotulo: 'Catálogos', descricao: 'CID e TUSS', href: '/catalogos', icone: Table },
  { value: 'perfil', rotulo: 'Meu perfil', descricao: 'Conta e preferências', href: '/configuracoes/perfil', icone: UserCircleGear },
] as const;

export default function LayoutConfiguracoes({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="cadencia-page space-y-6">
      <PageHeader
        titulo="Configurações"
        eyebrow="Administração"
        subtitulo="Organize a clínica, a equipe e as regras do prontuário em um só lugar."
        semBreadcrumb
      />

      <div className="grid items-start gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
        <nav aria-label="Seções de configurações" className="cadencia-surface hidden overflow-hidden p-2 lg:block">
          <div className="mb-1 flex items-center gap-2 px-3 py-2 text-xs font-bold text-text-faint">
            <GearSix size={15} aria-hidden />
            <span>Configurações</span>
          </div>
          {ABAS.map((aba) => {
            const ativa = pathname === aba.href || (aba.href !== '/configuracoes' && pathname.startsWith(`${aba.href}/`));
            const Icone = aba.icone;
            return (
              <Link
                key={aba.value}
                href={aba.href}
                aria-current={ativa ? 'page' : undefined}
                className={cn(
                  'group flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors-fast',
                  ativa ? 'bg-accent-soft text-accent' : 'text-text-muted hover:bg-surface-subtle hover:text-text',
                )}
              >
                <span className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg', ativa ? 'bg-surface text-accent shadow-elev-1' : 'bg-surface-subtle text-text-faint group-hover:text-accent')}>
                  <Icone size={15} weight={ativa ? 'fill' : 'regular'} aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{aba.rotulo}</span>
                  <span className={cn('mt-0.5 block text-[11px] leading-snug', ativa ? 'text-accent/75' : 'text-text-faint')}>{aba.descricao}</span>
                </span>
              </Link>
            );
          })}
        </nav>

        <nav aria-label="Seções de configurações" className="-mx-1 overflow-x-auto px-1 scrollbar-thin lg:hidden">
          <div className="flex min-w-max gap-1 rounded-xl border border-line bg-surface-subtle p-1">
            {ABAS.map((aba) => {
              const ativa = pathname === aba.href || (aba.href !== '/configuracoes' && pathname.startsWith(`${aba.href}/`));
              return (
                <Link
                  key={aba.value}
                  href={aba.href}
                  aria-current={ativa ? 'page' : undefined}
                  className={cn(
                    'rounded-lg px-3 py-2 text-xs font-semibold transition-colors-fast',
                    ativa ? 'bg-surface text-accent shadow-elev-1' : 'text-text-muted hover:bg-surface hover:text-text',
                  )}
                >
                  {aba.rotulo}
                </Link>
              );
            })}
          </div>
        </nav>

        <section className="min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-elev-1 sm:p-6 lg:min-h-[560px]">
          {children}
        </section>
      </div>
    </div>
  );
}
