'use client';

import { useState, type FormEvent } from 'react';
import { Key } from '@phosphor-icons/react';
import { Botao } from '../ui/Botao';

export interface TrocaDeSenhaProps {
  readonly aoTrocar: (senhaAtual: string, senhaNova: string) => Promise<void>;
}

export function TrocaDeSenha({ aoTrocar }: TrocaDeSenhaProps) {
  const [senhaAtual, setSenhaAtual] = useState('');
  const [senhaNova, setSenhaNova] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  const valida =
    senhaAtual.length > 0
    && senhaNova.length >= 8
    && senhaNova === confirmar;

  async function submeter(ev: FormEvent) {
    ev.preventDefault();
    if (!valida || enviando) return;
    setErro(null);
    setSucesso(false);
    setEnviando(true);
    try {
      await aoTrocar(senhaAtual, senhaNova);
      setSucesso(true);
      setSenhaAtual('');
      setSenhaNova('');
      setConfirmar('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao trocar senha';
      setErro(
        msg === 'senha_incorreta' ? 'Senha atual incorreta.'
        : msg === 'senha_fraca' ? 'A nova senha e muito fraca.'
        : 'Nao foi possivel trocar a senha.',
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={(ev) => { void submeter(ev); }} className="grid gap-4">
      <div className="flex items-center gap-2">
        <Key size={20} className="text-accent" />
        <h3 className="text-sm font-semibold">Trocar senha</h3>
      </div>

      <label className="grid gap-1">
        <span className="text-xs text-text-muted">Senha atual</span>
        <input type="password" autoComplete="current-password"
          value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
      </label>

      <label className="grid gap-1">
        <span className="text-xs text-text-muted">Nova senha</span>
        <input type="password" autoComplete="new-password"
          value={senhaNova} onChange={(e) => setSenhaNova(e.target.value)}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
        {senhaNova.length > 0 && senhaNova.length < 8 && (
          <span className="text-xs text-danger">Minimo 8 caracteres</span>
        )}
      </label>

      <label className="grid gap-1">
        <span className="text-xs text-text-muted">Confirmar senha</span>
        <input type="password" autoComplete="new-password"
          value={confirmar} onChange={(e) => setConfirmar(e.target.value)}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
        {confirmar.length > 0 && confirmar !== senhaNova && (
          <span className="text-xs text-danger">As senhas nao coincidem</span>
        )}
      </label>

      {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}
      {sucesso && <p className="text-sm text-accent">Senha alterada com sucesso.</p>}

      <Botao type="submit" variante="primario" tamanho="md"
        disabled={!valida} carregando={enviando}>
        Trocar senha
      </Botao>
    </form>
  );
}
