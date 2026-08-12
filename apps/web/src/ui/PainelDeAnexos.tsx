// apps/web/src/ui/PainelDeAnexos.tsx
'use client';

import { useState } from 'react';
import { Paperclip, FileArrowDown } from '@phosphor-icons/react';
import { PainelLateral } from './PainelLateral';
import { cn } from '../lib/cn';

export interface Anexo {
  readonly attachmentId: string;
  readonly kind: string;
  readonly originalName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly criadoEm: string;
}

export interface PainelDeAnexosProps {
  readonly aberto: boolean;
  readonly anexos: readonly Anexo[];
  readonly aoEnviar: (dados: { arquivo: File; kind: string }) => Promise<void>;
  readonly aoAbrir: (attachmentId: string) => Promise<void>;
  readonly aoFechar: () => void;
}

/** 20 MB — o mesmo teto da API. Barrar aqui poupa a subida inteira. */
const LIMITE_BYTES = 20 * 1024 * 1024;

const TIPOS: readonly { id: string; rotulo: string }[] = [
  { id: 'resultado_exame', rotulo: 'Resultado de exame' },
  { id: 'imagem', rotulo: 'Imagem' },
  { id: 'documento_externo', rotulo: 'Documento externo' },
  { id: 'consentimento', rotulo: 'Termo de consentimento' },
  { id: 'outro', rotulo: 'Outro' },
];

const ROTULO_KIND = Object.fromEntries(TIPOS.map((t) => [t.id, t.rotulo]));

function tamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2 })} MB`;
}

function dataCurta(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR',
    { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(iso));
}

/**
 * Os anexos do paciente: o exame que ele traz na mão.
 *
 * A lista mostra NOME, TIPO e TAMANHO — e o tamanho em unidade legível, porque
 * quem decide se abre um arquivo no meio da consulta precisa saber se são 200 KB
 * ou 40 MB antes de esperar o download.
 */
export function PainelDeAnexos(p: PainelDeAnexosProps) {
  const [kind, setKind] = useState(TIPOS[0]!.id);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [abrindo, setAbrindo] = useState<string | null>(null);

  async function escolher(f: File | undefined): Promise<void> {
    if (f === undefined) return;
    setErro(null);
    if (f.size === 0) { setErro('Arquivo vazio.'); return; }
    if (f.size > LIMITE_BYTES) {
      // A API também recusa, mas só DEPOIS de o celular da recepção gastar a
      // franquia subindo o arquivo inteiro.
      setErro(`Arquivo maior que 20 MB (${tamanho(f.size)}). Reduza ou envie por outro meio.`);
      return;
    }
    setEnviando(true);
    try {
      await p.aoEnviar({ arquivo: f, kind });
    } catch {
      setErro('Não foi possível enviar. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <PainelLateral aberto={p.aberto} titulo="Anexos" aoFechar={p.aoFechar}>
      <div className="grid gap-4">
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-text">Tipo do arquivo</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="w-full rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text"
          >
            {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}
          </select>
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-text">Escolher arquivo</span>
          <input
            type="file"
            disabled={enviando}
            onChange={(e) => { void escolher(e.target.files?.[0]); }}
            className="w-full text-sm text-text file:mr-3 file:rounded-[var(--r-sm)] file:border-0 file:bg-accent file:px-3 file:py-2 file:text-sm file:text-accent-on"
          />
        </label>

        {enviando && <p className="text-sm text-text-muted">Enviando…</p>}
        {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}

        <section className="grid gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            No prontuário
          </h3>
          {p.anexos.length === 0 ? (
            <p className="text-sm text-text-muted">
              Nenhum arquivo anexado a este paciente ainda.
            </p>
          ) : (
            <ul className="grid gap-1">
              {p.anexos.map((a) => (
                <li key={a.attachmentId}>
                  <button
                    type="button"
                    disabled={abrindo === a.attachmentId}
                    onClick={() => {
                      setAbrindo(a.attachmentId);
                      void p.aoAbrir(a.attachmentId)
                        .catch(() => setErro('Não foi possível abrir o arquivo.'))
                        .finally(() => setAbrindo(null));
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-[var(--r-sm)] px-2 py-2',
                      'text-left text-sm transition hover:bg-surface-hover',
                    )}
                  >
                    <Paperclip size={16} aria-hidden="true" className="shrink-0 text-text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-text">{a.originalName}</span>
                      <span className="block text-xs text-text-muted">
                        {ROTULO_KIND[a.kind] ?? a.kind} · {tamanho(a.sizeBytes)}
                        {' · '}{dataCurta(a.criadoEm)}
                      </span>
                    </span>
                    <FileArrowDown size={16} aria-hidden="true" className="shrink-0 text-text-muted" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PainelLateral>
  );
}
