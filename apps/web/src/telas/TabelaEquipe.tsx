'use client';

import { useState } from 'react';
import {
  CheckCircle,
  PencilSimple,
  ShieldCheck,
  ShieldSlash,
  Trash,
  UserCircle,
} from '@phosphor-icons/react';
import { Botao } from '../ui/Botao';
import { rotulo } from '../sessao';
import { cn } from '../lib/cn';

export interface MembroEquipe {
  readonly userId: string;
  readonly nome: string;
  readonly email: string;
  readonly role: 'admin_clinico' | 'diretor_tecnico' | 'profissional' | 'recepcao' | 'financeiro';
  readonly ehProfissional: boolean;
  readonly conselho: string | null;
  readonly desde: string;
  readonly temTotp: boolean;
}

export interface TabelaEquipeProps {
  readonly itens: readonly MembroEquipe[];
  readonly meuUserId: string;
  readonly ehAdmin: boolean;
  readonly aoRevogar: (userId: string, role: string, motivo?: string) => Promise<void>;
  readonly aoDesativarMfa: (userId: string) => Promise<void>;
  readonly aoAlterarPapel?: (userId: string, novoRole: string) => Promise<void>;
}

const PAPEIS: MembroEquipe['role'][] = [
  'admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro',
];

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  const primeira = partes[0]?.charAt(0) ?? '';
  const ultima = partes.length > 1 ? partes[partes.length - 1]?.charAt(0) ?? '' : '';
  return `${primeira}${ultima}`.toLocaleUpperCase('pt-BR');
}

export function TabelaEquipe({
  itens, meuUserId, ehAdmin, aoRevogar, aoDesativarMfa, aoAlterarPapel,
}: TabelaEquipeProps) {
  const [confirmando, setConfirmando] = useState<{
    tipo: 'revogar' | 'mfa' | 'papel'; userId: string; role?: string;
  } | null>(null);
  const [motivo, setMotivo] = useState('');
  const [novoPapel, setNovoPapel] = useState('');
  const [executando, setExecutando] = useState(false);

  async function confirmar() {
    if (!confirmando) return;
    setExecutando(true);
    try {
      if (confirmando.tipo === 'revogar') {
        await aoRevogar(confirmando.userId, confirmando.role!, motivo || undefined);
      } else if (confirmando.tipo === 'papel' && aoAlterarPapel) {
        await aoAlterarPapel(confirmando.userId, novoPapel);
      } else {
        await aoDesativarMfa(confirmando.userId);
      }
      setConfirmando(null);
      setMotivo('');
      setNovoPapel('');
    } finally {
      setExecutando(false);
    }
  }

  function cancelar() {
    setConfirmando(null);
    setMotivo('');
    setNovoPapel('');
  }

  return (
    <div className="cadencia-table-shell overflow-hidden">
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr>
              <th className="px-4 py-2.5 text-left">Pessoa</th>
              <th className="px-4 py-2.5 text-left">Papel</th>
              <th className="px-4 py-2.5 text-left">Segurança</th>
              <th className="px-4 py-2.5 text-left">Registro</th>
              <th className="px-4 py-2.5 text-left">Desde</th>
              {ehAdmin && <th className="px-4 py-2.5 text-right">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {itens.map((m) => {
              const ehEu = m.userId === meuUserId;
              const confirmandoEste = confirmando !== null && confirmando.userId === m.userId;

              return (
                <tr key={`${m.userId}-${m.role}`} className="border-t border-line transition-colors hover:bg-surface-hover/55">
                  <td className="px-4 py-3.5">
                    <div className="flex min-w-[220px] items-center gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-accent/10 bg-accent-soft text-[11px] font-bold text-accent">
                        {iniciais(m.nome)}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <strong className="block max-w-[260px] truncate text-[13px] font-semibold text-text">{m.nome}</strong>
                          {ehEu ? <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.05em] text-text-faint">Você</span> : null}
                        </span>
                        <span className="mt-0.5 block max-w-[280px] truncate text-[11px] text-text-muted">{m.email}</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    {confirmandoEste && confirmando.tipo === 'papel' ? (
                      <select
                        value={novoPapel}
                        onChange={(e) => setNovoPapel(e.target.value)}
                        className="h-9 rounded-[9px] border border-line-field bg-surface px-2.5 text-xs font-semibold text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/10 max-md:h-11"
                        aria-label="Novo papel"
                      >
                        {PAPEIS.filter((p) => p !== m.role).map((p) => (
                          <option key={p} value={p}>{rotulo(p)}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-line bg-surface-subtle px-2.5 py-1 text-[11px] font-semibold text-text-secondary">
                        {rotulo(m.role)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold',
                      m.temTotp
                        ? 'border-ok/15 bg-ok-soft text-ok'
                        : 'border-line bg-surface-subtle text-text-faint',
                    )}>
                      {m.temTotp ? <ShieldCheck size={13} weight="fill" aria-hidden /> : <UserCircle size={13} aria-hidden />}
                      {m.temTotp ? 'MFA ativo' : 'Sem MFA'}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-[11px] text-text-muted">{m.conselho ?? '—'}</td>
                  <td className="px-4 py-3.5 text-xs tabular-nums text-text-muted">
                    {m.desde.slice(0, 10).split('-').reverse().join('/')}
                  </td>
                  {ehAdmin && (
                    <td className="px-4 py-3.5">
                      {ehEu ? (
                        <span className="ml-auto flex w-fit items-center gap-1.5 text-[10px] font-semibold text-text-faint">
                          <CheckCircle size={14} weight="fill" className="text-ok" aria-hidden /> Conta atual
                        </span>
                      ) : confirmandoEste ? (
                        <div className="ml-auto grid max-w-[310px] gap-2">
                          {confirmando.tipo === 'revogar' && (
                            <input
                              type="text"
                              placeholder="Motivo da revogação (opcional)"
                              value={motivo}
                              onChange={(e) => setMotivo(e.target.value)}
                              className="h-9 w-full rounded-[9px] border border-line-field bg-surface px-3 text-xs outline-none focus:border-accent focus:ring-2 focus:ring-accent/10"
                              aria-label="Motivo da revogação"
                            />
                          )}
                          <div className="flex justify-end gap-2">
                            <Botao
                              variante={confirmando.tipo === 'papel' ? 'primario' : 'perigo'}
                              tamanho="sm"
                              carregando={executando}
                              onClick={() => confirmar()}
                            >
                              Confirmar
                            </Botao>
                            <Botao variante="secundario" tamanho="sm" disabled={executando} onClick={cancelar}>
                              Cancelar
                            </Botao>
                          </div>
                        </div>
                      ) : (
                        <div className="ml-auto flex w-fit flex-wrap justify-end gap-1.5">
                          {aoAlterarPapel && (
                            <Botao
                              variante="fantasma"
                              tamanho="sm"
                              iconeEsquerda={PencilSimple}
                              onClick={() => {
                                const primeiro = PAPEIS.find((p) => p !== m.role)!;
                                setNovoPapel(primeiro);
                                setConfirmando({ tipo: 'papel', userId: m.userId, role: m.role });
                              }}
                            >
                              Papel
                            </Botao>
                          )}
                          {m.temTotp && (
                            <Botao
                              variante="fantasma"
                              tamanho="sm"
                              iconeEsquerda={ShieldSlash}
                              onClick={() => setConfirmando({ tipo: 'mfa', userId: m.userId })}
                            >
                              MFA
                            </Botao>
                          )}
                          <Botao
                            variante="fantasma"
                            tamanho="sm"
                            iconeEsquerda={Trash}
                            className="!text-danger hover:!bg-danger-soft"
                            onClick={() => setConfirmando({ tipo: 'revogar', userId: m.userId, role: m.role })}
                          >
                            Revogar
                          </Botao>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {itens.length === 0 && (
              <tr>
                <td colSpan={ehAdmin ? 6 : 5} className="px-4 py-12 text-center text-sm text-text-muted">
                  Nenhum vínculo nesta unidade.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
