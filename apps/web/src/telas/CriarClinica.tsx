'use client';

import { useState, type FormEvent } from 'react';
import { X } from '@phosphor-icons/react';
import { Botao } from '../ui/Botao';

const FUSOS = [
  ['America/Sao_Paulo', 'Brasilia (UTC-3)'],
  ['America/Manaus', 'Manaus (UTC-4)'],
  ['America/Cuiaba', 'Cuiaba (UTC-4)'],
  ['America/Belem', 'Belem (UTC-3)'],
  ['America/Fortaleza', 'Fortaleza (UTC-3)'],
  ['America/Recife', 'Recife (UTC-3)'],
  ['America/Rio_Branco', 'Rio Branco (UTC-5)'],
  ['America/Noronha', 'Fernando de Noronha (UTC-2)'],
] as const;

export interface DadosCriacaoClinica {
  readonly nome: string;
  readonly timezone: string;
  readonly cnpj?: string;
  readonly cnes?: string;
}

export interface CriarClinicaProps {
  readonly aberto: boolean;
  readonly aoFechar: () => void;
  readonly aoCriar: (dados: DadosCriacaoClinica) => Promise<void>;
}

export function CriarClinica({ aberto, aoFechar, aoCriar }: CriarClinicaProps) {
  const [nome, setNome] = useState('');
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [cnpj, setCnpj] = useState('');
  const [cnes, setCnes] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const valida = nome.length >= 2;

  function resetar() {
    setNome(''); setTimezone('America/Sao_Paulo');
    setCnpj(''); setCnes(''); setErro(null);
  }

  async function submeter(ev: FormEvent) {
    ev.preventDefault();
    if (!valida || enviando) return;
    setErro(null);
    setEnviando(true);
    try {
      const dados: DadosCriacaoClinica = {
        nome, timezone,
        ...(cnpj ? { cnpj } : {}),
        ...(cnes ? { cnes } : {}),
      };
      await aoCriar(dados);
      resetar();
      aoFechar();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao criar';
      setErro(
        msg === 'fuso_invalido'
          ? 'Fuso horario invalido.'
          : 'Nao foi possivel criar a unidade.',
      );
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-text/25"
      role="dialog" aria-modal="true" aria-label="Criar unidade">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Criar unidade</h2>
          <button type="button" onClick={() => { resetar(); aoFechar(); }}
            aria-label="Fechar" className="text-text-muted hover:text-text">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={(ev) => { void submeter(ev); }} className="grid gap-4">
          <label className="grid gap-1">
            <span className="text-xs text-text-muted">Nome da unidade</span>
            <input type="text" required minLength={2}
              value={nome} onChange={(e) => setNome(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-text-muted">Fuso horario</span>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
              {FUSOS.map(([valor, texto]) => (
                <option key={valor} value={valor}>{texto}</option>
              ))}
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-text-muted">CNPJ (opcional)</span>
            <input type="text" placeholder="12345678000190"
              value={cnpj} onChange={(e) => setCnpj(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-mono" />
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-text-muted">CNES (opcional)</span>
            <input type="text" placeholder="1234567" maxLength={7}
              value={cnes} onChange={(e) => setCnes(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-mono" />
          </label>

          {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}

          <div className="flex gap-3 pt-2">
            <Botao type="submit" variante="primario" tamanho="md"
              disabled={!valida} carregando={enviando}>
              Criar
            </Botao>
            <Botao type="button" variante="secundario" tamanho="md"
              disabled={enviando}
              onClick={() => { resetar(); aoFechar(); }}>
              Cancelar
            </Botao>
          </div>
        </form>
      </div>
    </div>
  );
}
