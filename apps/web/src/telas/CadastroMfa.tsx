'use client';

import { useState } from 'react';
import { ShieldCheck, Copy, CheckCircle } from '@phosphor-icons/react';
import { Botao } from '../ui/Botao';

export interface CadastroMfaProps {
  readonly mfaCadastrado: boolean;
  readonly aoIniciar: () => Promise<{ qrcodeUri: string; segredo: string }>;
  readonly aoConfirmar: (codigo: string) => Promise<void>;
}

type Fase = 'inicial' | 'inscricao' | 'confirmado';

export function CadastroMfa({ mfaCadastrado, aoIniciar, aoConfirmar }: CadastroMfaProps) {
  const [fase, setFase] = useState<Fase>(mfaCadastrado ? 'confirmado' : 'inicial');
  const [segredo, setSegredo] = useState('');
  const [qrcodeUri, setQrcodeUri] = useState('');
  const [codigo, setCodigo] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function iniciar() {
    setCarregando(true);
    setErro(null);
    try {
      const r = await aoIniciar();
      setSegredo(r.segredo);
      setQrcodeUri(r.qrcodeUri);
      setFase('inscricao');
    } catch {
      setErro('Não foi possível iniciar o cadastro.');
    } finally {
      setCarregando(false);
    }
  }

  async function confirmar() {
    if (codigo.length !== 6) return;
    setCarregando(true);
    setErro(null);
    try {
      await aoConfirmar(codigo);
      setFase('confirmado');
      setCodigo('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setErro(
        msg === 'codigo_invalido' ? 'Código inválido. Tente novamente.'
        : msg === 'codigo_reutilizado' ? 'Código já utilizado. Aguarde o próximo.'
        : 'Não foi possível confirmar o código.',
      );
    } finally {
      setCarregando(false);
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(segredo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Fallback: selecionar o texto e nada mais
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <ShieldCheck size={20} className="text-accent" />
        <h3 className="text-sm font-semibold">Autenticação em dois fatores</h3>
      </div>

      {fase === 'confirmado' && (
        <div className="flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2">
          <CheckCircle size={18} weight="fill" className="text-accent" />
          <span className="text-sm font-medium text-accent">MFA ativo</span>
          <Botao variante="fantasma" tamanho="sm" className="ml-auto"
            onClick={() => iniciar()}>
            Reconfigurar
          </Botao>
        </div>
      )}

      {fase === 'inicial' && (
        <div>
          <p className="mb-3 text-sm text-text-muted">
            O segundo fator protege sua conta mesmo se alguém descobrir sua senha.
            Use um app autenticador como Google Authenticator, Authy ou 1Password.
          </p>
          <Botao variante="secundario" tamanho="md" carregando={carregando}
            onClick={() => iniciar()}>
            Configurar MFA
          </Botao>
        </div>
      )}

      {fase === 'inscricao' && (
        <div className="grid gap-4 rounded-xl border border-line bg-surface p-4">
          <p className="text-sm text-text-muted">
            Abra seu app autenticador e adicione uma nova conta. Copie a chave abaixo
            ou use o link para adicionar automaticamente.
          </p>

          <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm">
            <span className="flex-1 select-all break-all">{segredo}</span>
            <button type="button" onClick={() => copiar()}
              className="shrink-0 rounded p-1 hover:bg-surface-hover max-md:min-h-11 max-md:min-w-11 max-md:inline-grid max-md:place-items-center"
              aria-label="Copiar segredo">
              {copiado
                ? <CheckCircle size={18} className="text-accent" />
                : <Copy size={18} className="text-text-muted" />}
            </button>
          </div>

          <details className="text-xs text-text-muted">
            <summary className="cursor-pointer hover:text-text">Link para app autenticador</summary>
            <code className="mt-1 block break-all rounded bg-surface-2 p-2">{qrcodeUri}</code>
          </details>

          <label className="grid gap-1">
            <span className="text-xs text-text-muted">Código de 6 dígitos</span>
            <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
              autoComplete="one-time-code"
              value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
              className="w-32 rounded-lg border border-line bg-surface px-3 py-2 text-center font-mono text-lg tracking-widest" />
          </label>

          {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}

          <Botao variante="primario" tamanho="md" carregando={carregando}
            disabled={codigo.length !== 6}
            onClick={() => confirmar()}>
            Confirmar
          </Botao>
        </div>
      )}
    </div>
  );
}
