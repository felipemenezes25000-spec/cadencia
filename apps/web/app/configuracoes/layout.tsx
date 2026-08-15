'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  CaretRight,
  ChatCircle,
  CreditCard,
  GearSix,
  MagnifyingGlass,
  NotePencil,
  ShieldCheck,
  Stethoscope,
  Table,
  UserCircleGear,
  Users,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { cn } from '../../src/lib/cn';
import { useSessao } from '../../src/sessao';
import './settings.css';
import './settings-alignment.css';

interface ItemConfiguracao {
  readonly value: string;
  readonly rotulo: string;
  readonly descricao: string;
  readonly href: string;
  readonly icone: PhosphorIcon;
}

interface GrupoConfiguracao {
  readonly rotulo: string;
  readonly descricao: string;
  readonly itens: readonly ItemConfiguracao[];
}

const GRUPOS: readonly GrupoConfiguracao[] = [
  {
    rotulo: 'Organização',
    descricao: 'Estrutura e operação clínica',
    itens: [
      { value: 'clinica', rotulo: 'Clínica', descricao: 'Unidades, cadastro e fuso', href: '/configuracoes', icone: Stethoscope },
      { value: 'procedimentos', rotulo: 'Procedimentos', descricao: 'Serviços e catálogo da unidade', href: '/configuracoes/procedimentos', icone: Table },
      { value: 'prontuario', rotulo: 'Prontuário', descricao: 'Estrutura e padrões clínicos', href: '/configuracoes/prontuario', icone: NotePencil },
    ],
  },
  {
    rotulo: 'Pessoas & segurança',
    descricao: 'Acesso, papéis e rastreabilidade',
    itens: [
      { value: 'equipe', rotulo: 'Equipe', descricao: 'Pessoas, convites e MFA', href: '/configuracoes/equipe', icone: Users },
      { value: 'permissoes', rotulo: 'Permissões', descricao: 'Papéis e níveis de acesso', href: '/configuracoes/permissoes', icone: ShieldCheck },
      { value: 'auditoria', rotulo: 'Auditoria', descricao: 'Histórico de alterações', href: '/configuracoes/auditoria', icone: ShieldCheck },
    ],
  },
  {
    rotulo: 'Comunicação',
    descricao: 'Canais usados pela clínica',
    itens: [
      { value: 'canais', rotulo: 'Canais', descricao: 'WhatsApp, SMS e e-mail', href: '/configuracoes/canais', icone: ChatCircle },
    ],
  },
  {
    rotulo: 'Dados & conta',
    descricao: 'Portabilidade e assinatura',
    itens: [
      { value: 'exportar', rotulo: 'Exportar dados', descricao: 'Portabilidade e segurança', href: '/configuracoes/exportar', icone: Table },
      { value: 'catalogos', rotulo: 'Catálogos', descricao: 'CID, TUSS e referências', href: '/catalogos', icone: Table },
      { value: 'plano', rotulo: 'Plano', descricao: 'Assinatura e faturamento', href: '/configuracoes/plano', icone: CreditCard },
      { value: 'perfil', rotulo: 'Meu perfil', descricao: 'Conta e preferências', href: '/configuracoes/perfil', icone: UserCircleGear },
    ],
  },
] as const;

const PAPEIS: Record<string, string> = {
  admin_clinico: 'Administrador clínico',
  diretor_tecnico: 'Diretor técnico',
  profissional: 'Profissional',
  recepcao: 'Recepção',
  financeiro: 'Financeiro',
};

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

export default function LayoutConfiguracoes({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const sessao = useSessao();
  const [busca, setBusca] = useState('');

  const todos = GRUPOS.flatMap((grupo) => grupo.itens);
  const ativa = todos.find((item) => pathname === item.href
    || (item.href !== '/configuracoes' && pathname.startsWith(`${item.href}/`))) ?? GRUPOS[0]!.itens[0]!;
  const grupoAtivo = GRUPOS.find((grupo) => grupo.itens.some((item) => item.value === ativa.value)) ?? GRUPOS[0]!;
  const IconeAtivo = ativa.icone;

  const gruposFiltrados = useMemo(() => {
    const termo = normalizar(busca.trim());
    if (!termo) return GRUPOS;
    return GRUPOS.map((grupo) => ({
      ...grupo,
      itens: grupo.itens.filter((item) => normalizar(`${item.rotulo} ${item.descricao} ${grupo.rotulo}`).includes(termo)),
    })).filter((grupo) => grupo.itens.length > 0);
  }, [busca]);

  return (
    <div className="cadencia-page settings-page">
      <header className="settings-hero">
        <div className="settings-hero-copy">
          <div className="settings-hero-icon" aria-hidden>
            <GearSix size={23} weight="duotone" />
          </div>
          <div>
            <p className="settings-eyebrow">Administração da clínica</p>
            <h1>Configurações</h1>
            <p>Organize a operação, os acessos e os dados da clínica sem perder contexto.</p>
          </div>
        </div>
        <div className="settings-context-card" aria-label="Contexto atual">
          <span className="settings-context-dot" aria-hidden />
          <div className="min-w-0">
            <strong>{sessao.vinculoAtivo.clinicNome}</strong>
            <span>{PAPEIS[sessao.vinculoAtivo.role] ?? sessao.vinculoAtivo.role}</span>
          </div>
        </div>
      </header>

      <div className="settings-mobile-nav lg:hidden">
        <div className="settings-mobile-current">
          <span className="settings-mobile-current-icon"><IconeAtivo size={18} weight="duotone" aria-hidden /></span>
          <span className="min-w-0 flex-1">
            <strong>{ativa.rotulo}</strong>
            <small>{grupoAtivo.rotulo}</small>
          </span>
        </div>
        <label className="settings-mobile-select">
          <span className="sr-only">Ir para seção de configurações</span>
          <select value={ativa.href} onChange={(evento) => router.push(evento.target.value)}>
            {GRUPOS.map((grupo) => (
              <optgroup key={grupo.rotulo} label={grupo.rotulo}>
                {grupo.itens.map((item) => <option key={item.value} value={item.href}>{item.rotulo}</option>)}
              </optgroup>
            ))}
          </select>
          <CaretRight size={16} aria-hidden />
        </label>
      </div>

      <div className="settings-layout">
        <aside className="settings-nav hidden lg:block">
          <div className="settings-nav-sticky">
            <div className="settings-search">
              <MagnifyingGlass size={16} aria-hidden />
              <input
                value={busca}
                onChange={(evento) => setBusca(evento.target.value)}
                placeholder="Buscar configuração"
                aria-label="Buscar nas configurações"
              />
              {busca ? <button type="button" onClick={() => setBusca('')} aria-label="Limpar busca">×</button> : null}
            </div>

            <nav aria-label="Seções de configurações" className="settings-nav-groups">
              {gruposFiltrados.length > 0 ? gruposFiltrados.map((grupo) => (
                <section key={grupo.rotulo} className="settings-nav-group">
                  <div className="settings-nav-group-heading">
                    <span>{grupo.rotulo}</span>
                    <small>{grupo.descricao}</small>
                  </div>
                  <div className="settings-nav-links">
                    {grupo.itens.map((item) => {
                      const ativaItem = item.value === ativa.value;
                      const Icone = item.icone;
                      return (
                        <Link
                          key={item.value}
                          href={item.href}
                          aria-current={ativaItem ? 'page' : undefined}
                          className={cn('settings-nav-link', ativaItem && 'is-active')}
                        >
                          <span className="settings-nav-link-icon"><Icone size={17} weight={ativaItem ? 'fill' : 'regular'} aria-hidden /></span>
                          <span className="min-w-0 flex-1">
                            <strong>{item.rotulo}</strong>
                            <small>{item.descricao}</small>
                          </span>
                          <CaretRight size={14} className="settings-nav-link-caret" aria-hidden />
                        </Link>
                      );
                    })}
                  </div>
                </section>
              )) : (
                <div className="settings-search-empty">
                  <MagnifyingGlass size={20} aria-hidden />
                  <strong>Nada encontrado</strong>
                  <span>Tente outro termo.</span>
                </div>
              )}
            </nav>

            <div className="settings-security-note">
              <ShieldCheck size={18} weight="duotone" aria-hidden />
              <div>
                <strong>Alterações protegidas</strong>
                <span>Ações sensíveis ficam registradas na auditoria.</span>
              </div>
            </div>
          </div>
        </aside>

        <main className="settings-stage">
          <header className="settings-stage-header">
            <div className="settings-stage-title">
              <span className="settings-stage-icon"><IconeAtivo size={21} weight="duotone" aria-hidden /></span>
              <div>
                <div className="settings-stage-breadcrumb">
                  <span>Configurações</span><CaretRight size={11} aria-hidden /><span>{grupoAtivo.rotulo}</span>
                </div>
                <h2>{ativa.rotulo}</h2>
                <p>{ativa.descricao}</p>
              </div>
            </div>
            <div className="settings-stage-status">
              <span className="settings-context-dot" aria-hidden />
              <span>Unidade ativa</span>
            </div>
          </header>

          <div className="settings-content-body">{children}</div>
        </main>
      </div>
    </div>
  );
}
