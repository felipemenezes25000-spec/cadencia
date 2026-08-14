// apps/web/src/telas/ConveniosOperadoras.tsx
'use client';

import { useEffect, useState, useMemo, type ChangeEvent } from 'react';
import {
  MagnifyingGlass,
  Plus,
  PencilSimple,
  Trash,
  Buildings,
} from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { useEstadoNaUrl } from '../hooks/useEstadoNaUrl';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { DialogoDeConfirmacao } from '../ui/DialogoDeConfirmacao';
import { Icone } from '../ui/Icone';
import { PainelLateral } from '../ui/PainelLateral';
import { Skeleton } from '../ui/Skeleton';
import { Tooltip } from '../ui/Tooltip';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface Operadora {
  readonly id: string;
  readonly nome: string;
  readonly registroAns: string;
  readonly versaoTiss: string;
  readonly cnpj: string;
  readonly email: string | null;
  readonly telefone: string | null;
  readonly ativa: boolean;
  readonly totalPacientes: number;
}

export interface OperadorasDados {
  readonly operadoras: readonly Operadora[];
}

export interface ConveniosOperadorasProps {
  readonly carregarDados: () => Promise<OperadorasDados>;
  readonly aoSalvar: (op: Partial<Operadora> & { nome: string; registroAns: string }) => Promise<void>;
  readonly aoDesativar: (operadoraId: string) => Promise<void>;
}

// ── Skeleton de carregamento ──────────────────────────────────────────────

function TabelaSkeleton() {
  return (
    <div
      role="status"
      aria-label="Carregando operadoras"
      className="overflow-hidden rounded-xl border border-line bg-surface shadow-elev-1"
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-raised">
            <th className="px-4 py-2.5 text-left"><Skeleton variant="text" width="80px" /></th>
            <th className="px-4 py-2.5 text-left"><Skeleton variant="text" width="80px" /></th>
            <th className="px-4 py-2.5 text-left"><Skeleton variant="text" width="100px" /></th>
            <th className="px-4 py-2.5 text-right"><Skeleton variant="text" width="60px" /></th>
            <th className="px-4 py-2.5 w-20" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {Array.from({ length: 4 }, (_, i) => (
            <tr key={i}>
              <td className="px-4 py-3"><Skeleton variant="text" width="120px" /></td>
              <td className="px-4 py-3"><Skeleton variant="text" width="60px" /></td>
              <td className="px-4 py-3"><Skeleton variant="text" width="110px" /></td>
              <td className="px-4 py-3"><Skeleton variant="text" width="40px" /></td>
              <td className="px-4 py-3"><Skeleton variant="text" width="50px" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Estado vazio ──────────────────────────────────────────────────────────

function EstadoVazioOperadoras() {
  return (
    <div className="rounded-xl border border-line bg-surface shadow-elev-1 p-8 text-center">
      <Buildings size={40} className="mx-auto mb-3 text-text-muted" aria-hidden />
      <p className="text-sm font-medium text-text">Nenhuma operadora cadastrada</p>
      <p className="mt-1 text-xs text-text-muted">
        Cadastre a primeira operadora para começar a faturar.
      </p>
    </div>
  );
}

// ── Componente ─────────────────────────────────────────────────────────────

export function ConveniosOperadoras(p: ConveniosOperadorasProps) {
  const [dados, setDados] = useState<OperadorasDados | null>(null);
  const [formAberto, setFormAberto] = useState(false);
  const [busca, setBusca] = useEstadoNaUrl('busca');
  const [operadoraParaExcluir, setOperadoraParaExcluir] = useState<Operadora | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [erroExclusao, setErroExclusao] = useState<string | null>(null);

  // Form state
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [registroAns, setRegistroAns] = useState('');
  const [versaoTiss, setVersaoTiss] = useState('4.01.00');
  const [cnpj, setCnpj] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');

  useEffect(() => {
    void p.carregarDados().then(setDados);
  }, [p]);

  const operadorasFiltradas = useMemo(() => {
    if (!dados) return [];
    if (busca.trim() === '') return [...dados.operadoras];
    const termo = busca.toLowerCase();
    return dados.operadoras.filter(
      (op) =>
        op.nome.toLowerCase().includes(termo) ||
        op.registroAns.toLowerCase().includes(termo) ||
        op.cnpj.toLowerCase().includes(termo),
    );
  }, [dados, busca]);

  function limparForm(): void {
    setEditandoId(null);
    setNome('');
    setRegistroAns('');
    setVersaoTiss('4.01.00');
    setCnpj('');
    setEmail('');
    setTelefone('');
  }

  function abrirNovaOperadora(): void {
    limparForm();
    setFormAberto(true);
  }

  function abrirEdicao(op: Operadora): void {
    setEditandoId(op.id);
    setNome(op.nome);
    setRegistroAns(op.registroAns);
    setVersaoTiss(op.versaoTiss);
    setCnpj(op.cnpj);
    setEmail(op.email ?? '');
    setTelefone(op.telefone ?? '');
    setFormAberto(true);
  }

  function salvar(): void {
    void p.aoSalvar({
      ...(editandoId != null ? { id: editandoId } : {}),
      nome,
      registroAns,
      versaoTiss,
      cnpj,
      email: email === '' ? null : email,
      telefone: telefone === '' ? null : telefone,
    }).then(() => {
      setFormAberto(false);
      limparForm();
    });
  }

  async function confirmarExclusao(): Promise<void> {
    if (!operadoraParaExcluir || excluindo) return;
    setExcluindo(true);
    setErroExclusao(null);
    try {
      await p.aoDesativar(operadoraParaExcluir.id);
      setDados((atual) => atual == null ? atual : {
        operadoras: atual.operadoras.filter((item) => item.id !== operadoraParaExcluir.id),
      });
      setOperadoraParaExcluir(null);
    } catch {
      setErroExclusao('Não foi possível excluir a operadora. Tente novamente.');
    } finally {
      setExcluindo(false);
    }
  }

  // Estado de carregamento
  if (dados === null) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton variant="text" width="240px" height="36px" />
          <Skeleton variant="text" width="130px" height="36px" />
        </div>
        <TabelaSkeleton />
      </div>
    );
  }

  const tituloForm = editandoId != null ? 'Editar operadora' : 'Nova operadora';

  return (
    <div className="space-y-4">
      {/* Ações */}
      <div className="flex items-center justify-between gap-3">
        <Campo
          prefixo={<Icone icon={MagnifyingGlass} size="sm" />}
          placeholder="Buscar operadora…"
          className="max-w-xs"
          value={busca}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setBusca(e.target.value)}
          aria-label="Buscar operadora"
        />
        <Botao variante="primario" iconeEsquerda={Plus} onClick={abrirNovaOperadora}>
          Nova operadora
        </Botao>
      </div>

      {/* Estado vazio ou tabela */}
      {operadorasFiltradas.length === 0 ? (
        <EstadoVazioOperadoras />
      ) : (
        <section aria-label="Operadoras cadastradas">
          <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-elev-1">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-raised">
                    <th className="px-4 py-2.5 text-left font-medium text-text-muted">
                      Operadora
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-text-muted">
                      Registro ANS
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-text-muted">
                      CNPJ
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium text-text-muted">
                      Pacientes
                    </th>
                    <th className="px-4 py-2.5 w-20">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {operadorasFiltradas.map((op) => (
                    <tr
                      key={op.id}
                      className={cn(
                        'hover:bg-surface-raised transition-colors-fast',
                        !op.ativa && 'opacity-60',
                      )}
                    >
                      <td className="px-4 py-3 font-medium text-text">
                        <div className="flex items-center gap-2">
                          {op.nome}
                          {!op.ativa && (
                            <span
                              className={cn(
                                'inline-flex items-center',
                                'text-[length:var(--fs-11)] uppercase tracking-[.04em]',
                                'font-medium px-[var(--s-4)] py-[var(--s-1)]',
                                'rounded-full text-text-faint bg-surface-sunken',
                              )}
                            >
                              Inativa
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-text-muted tabular-nums">
                        {op.registroAns}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-text-muted tabular-nums">
                        {op.cnpj}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {op.totalPacientes}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <Tooltip conteudo="Editar">
                            <button
                              type="button"
                              aria-label="Editar"
                              className={cn(
                                'rounded-md p-1 text-text-muted',
                                'hover:bg-surface-raised hover:text-text',
                                'transition-colors-fast',
                                'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
                              )}
                              onClick={() => abrirEdicao(op)}
                            >
                              <Icone icon={PencilSimple} size="sm" />
                            </button>
                          </Tooltip>
                          <Tooltip conteudo="Excluir">
                            <button
                              type="button"
                              aria-label="Excluir"
                              className={cn(
                                'rounded-md p-1 text-text-muted',
                                'hover:text-danger',
                                'transition-colors-fast',
                                'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
                              )}
                              onClick={() => {
                                setErroExclusao(null);
                                setOperadoraParaExcluir(op);
                              }}
                            >
                              <Icone icon={Trash} size="sm" />
                            </button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Formulário de nova/editar operadora */}
      <PainelLateral
        aberto={formAberto}
        titulo={tituloForm}
        aoFechar={() => setFormAberto(false)}
      >
        <div className="grid gap-[var(--s-5)] mt-[var(--s-4)]">
          <Campo
            rotulo="Nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            aria-label="Nome"
            required
          />
          <Campo
            rotulo="Registro ANS"
            value={registroAns}
            onChange={(e) => setRegistroAns(e.target.value)}
            aria-label="Registro ANS"
            maxLength={6}
            required
          />
          <Campo
            rotulo="Versão TISS"
            value={versaoTiss}
            onChange={(e) => setVersaoTiss(e.target.value)}
            aria-label="Versão TISS"
          />
          <Campo
            rotulo="CNPJ"
            value={cnpj}
            onChange={(e) => setCnpj(e.target.value)}
            aria-label="CNPJ"
            maxLength={14}
          />
          <Campo
            rotulo="E-mail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="E-mail"
          />
          <Campo
            rotulo="Telefone"
            type="tel"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            aria-label="Telefone"
          />
          <Botao variante="primario" tamanho="lg" onClick={salvar} fullWidth>
            Salvar
          </Botao>
        </div>
      </PainelLateral>

      <DialogoDeConfirmacao
        aberto={operadoraParaExcluir != null}
        titulo={`Excluir ${operadoraParaExcluir?.nome ?? 'operadora'}?`}
        descricao="A operadora deixará de aparecer nas opções de faturamento. Esta ação exige confirmação."
        confirmarRotulo="Confirmar exclusão"
        destrutivo
        carregando={excluindo}
        erro={erroExclusao}
        aoConfirmar={() => { void confirmarExclusao(); }}
        aoFechar={() => {
          setOperadoraParaExcluir(null);
          setErroExclusao(null);
        }}
      />
    </div>
  );
}
