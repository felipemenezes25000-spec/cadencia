'use client';

import { useState } from 'react';
import { Trash, ShieldSlash, PencilSimple } from '@phosphor-icons/react';
import { Botao } from '../ui/Botao';
import { rotulo } from '../sessao';

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
    <div className="overflow-x-auto rounded-[var(--r-md)] border border-line">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-surface-2 text-left text-xs uppercase text-text-muted">
          <tr>
            <th className="px-4 py-2.5 font-medium">Pessoa</th>
            <th className="px-4 py-2.5 font-medium">Papel</th>
            <th className="px-4 py-2.5 font-medium">Registro</th>
            <th className="px-4 py-2.5 font-medium">Desde</th>
            {ehAdmin && <th className="px-4 py-2.5 font-medium">Ações</th>}
          </tr>
        </thead>
        <tbody>
          {itens.map((m) => {
            const ehEu = m.userId === meuUserId;
            const confirmandoEste =
              confirmando !== null && confirmando.userId === m.userId;

            return (
              <tr key={`${m.userId}-${m.role}`} className="border-t border-line">
                <td className="px-4 py-3">
                  <span className="block font-medium">{m.nome}</span>
                  <span className="block break-words text-xs text-text-muted">{m.email}</span>
                </td>
                <td className="px-4 py-3">
                  {confirmandoEste && confirmando.tipo === 'papel' ? (
                    <select
                      value={novoPapel}
                      onChange={(e) => setNovoPapel(e.target.value)}
                      className="h-8 max-md:h-11 rounded-[var(--r-md)] border border-line bg-surface px-2 text-sm"
                      aria-label="Novo papel"
                    >
                      {PAPEIS.filter((p) => p !== m.role).map((p) => (
                        <option key={p} value={p}>{rotulo(p)}</option>
                      ))}
                    </select>
                  ) : rotulo(m.role)}
                </td>
                <td className="px-4 py-3 font-mono text-xs">{m.conselho ?? '—'}</td>
                <td className="px-4 py-3 text-xs text-text-muted">
                  {m.desde.slice(0, 10).split('-').reverse().join('/')}
                </td>
                {ehAdmin && (
                  <td className="px-4 py-3">
                    {ehEu ? null : confirmandoEste ? (
                      <div className="grid gap-2">
                        {confirmando.tipo === 'revogar' && (
                          <input
                            type="text"
                            placeholder="Motivo (opcional)"
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                            className="rounded-lg border border-line bg-surface px-2 py-1 text-xs"
                            aria-label="Motivo da revogação"
                          />
                        )}
                        <div className="flex gap-2">
                          <Botao variante={confirmando.tipo === 'papel' ? 'primario' : 'perigo'}
                            tamanho="sm" carregando={executando}
                            onClick={() => confirmar()}>
                            Confirmar
                          </Botao>
                          <Botao variante="secundario" tamanho="sm"
                            disabled={executando}
                            onClick={cancelar}>
                            Cancelar
                          </Botao>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        {aoAlterarPapel && (
                          <Botao variante="secundario" tamanho="sm"
                            iconeEsquerda={PencilSimple}
                            onClick={() => {
                              const primeiro = PAPEIS.find((p) => p !== m.role)!;
                              setNovoPapel(primeiro);
                              setConfirmando({
                                tipo: 'papel', userId: m.userId, role: m.role,
                              });
                            }}>
                            Alterar papel
                          </Botao>
                        )}
                        <Botao variante="perigo" tamanho="sm"
                          iconeEsquerda={Trash}
                          onClick={() => setConfirmando({
                            tipo: 'revogar', userId: m.userId, role: m.role,
                          })}>
                          Revogar
                        </Botao>
                        {m.temTotp && (
                          <Botao variante="secundario" tamanho="sm"
                            iconeEsquerda={ShieldSlash}
                            onClick={() => setConfirmando({
                              tipo: 'mfa', userId: m.userId,
                            })}>
                            Desativar MFA
                          </Botao>
                        )}
                      </div>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          {itens.length === 0 && (
            <tr>
              <td colSpan={ehAdmin ? 5 : 4}
                className="px-4 py-6 text-center text-text-muted">
                Nenhum vínculo nesta unidade.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
