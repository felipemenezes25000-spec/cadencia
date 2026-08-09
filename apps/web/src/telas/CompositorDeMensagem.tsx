// apps/web/src/telas/CompositorDeMensagem.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Paperclip,
  PaperPlaneRight,
  X,
  FileText,
  TextAlignLeft,
} from '@phosphor-icons/react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { cn } from '../lib/cn';
import { Botao } from '../ui/Botao';
import { Icone } from '../ui/Icone';
import { Tooltip } from '../ui/Tooltip';

/* ── Tipos ──────────────────────────────────────────────────────────── */

export interface TemplateMensagem {
  readonly id: string;
  readonly titulo: string;
  readonly conteudo: string;
}

export interface CompositorDeMensagemProps {
  /** Callback disparado ao enviar uma mensagem */
  readonly onEnviar: (mensagem: string, arquivos?: File[]) => void;
  /** Desabilita o compositor inteiro */
  readonly disabled?: boolean;
  /** Placeholder do textarea */
  readonly placeholder?: string;
  /** Templates opcionais para o seletor rapido */
  readonly templates?: readonly TemplateMensagem[];
}

/* ── Seletor de Templates (sub-componente) ──────────────────────────── */

function SeletorDeTemplates({
  templates,
  onInserir,
}: {
  readonly templates: readonly TemplateMensagem[];
  readonly onInserir: (texto: string) => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Tooltip conteudo="Usar template">
          <button
            type="button"
            className={cn(
              'grid h-9 w-9 place-items-center rounded-xl border border-transparent text-text-muted',
              'hover:border-line hover:bg-surface-raised hover:text-text transition-all',
            )}
          >
            <Icone icon={TextAlignLeft} size="md" />
          </button>
        </Tooltip>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={8}
          className={cn(
            'z-50 w-80 max-h-72 overflow-y-auto',
            'rounded-2xl border border-line/80',
            'bg-surface/95 shadow-[var(--elev-float)] backdrop-blur-xl p-1.5 scrollbar-thin',
          )}
        >
          {templates.map((t) => (
            <DropdownMenu.Item
              key={t.id}
              onSelect={() => onInserir(t.conteudo)}
              className={cn(
                'rounded-xl px-3 py-2.5 text-left cursor-pointer outline-none transition-colors',
                'data-[highlighted]:bg-accent-soft data-[highlighted]:text-text',
              )}
            >
              <p className="text-sm font-medium text-text">{t.titulo}</p>
              <p className="text-xs text-text-muted truncate">{t.conteudo}</p>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* ── Compositor de Mensagem ─────────────────────────────────────────── */

export function CompositorDeMensagem({
  onEnviar,
  disabled,
  placeholder,
  templates,
}: CompositorDeMensagemProps) {
  const [texto, setTexto] = useState('');
  const [arquivos, setArquivos] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleEnviar() {
    const trimmed = texto.trim();
    if (!trimmed && arquivos.length === 0) return;
    onEnviar(trimmed, arquivos.length > 0 ? arquivos : undefined);
    setTexto('');
    setArquivos([]);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEnviar();
    }
  }

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  }, [texto]);

  return (
    <div className="relative border-t border-line/70 bg-surface/95 px-3 py-3 backdrop-blur-xl sm:px-4">
      {/* Preview de arquivos anexados */}
      {arquivos.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2" data-testid="arquivos-preview">
          {arquivos.map((f, i) => (
            <div
              key={`${f.name}-${i}`}
              className={cn(
                'flex items-center gap-1.5',
                'rounded-xl border border-line/70 bg-surface-raised px-2.5 py-1.5 text-xs shadow-[0_4px_12px_rgb(15_23_42/.04)]',
              )}
            >
              <Icone icon={FileText} size="sm" className="text-text-muted" />
              <span className="text-text truncate max-w-[120px]">{f.name}</span>
              <button
                type="button"
                onClick={() => setArquivos((prev) => prev.filter((_, j) => j !== i))}
                className="text-text-muted hover:text-danger transition-colors-fast"
                aria-label={`Remover ${f.name}`}
              >
                <Icone icon={X} size="sm" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Anexar arquivo */}
        <Tooltip conteudo="Anexar arquivo">
          <label
            className={cn(
              'grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-xl border border-transparent',
              'text-text-muted hover:border-line hover:bg-surface-raised hover:text-text transition-all',
            )}
          >
            <Icone icon={Paperclip} size="md" />
            <input
              type="file"
              multiple
              className="hidden"
              aria-label="Anexar arquivo"
              onChange={(e) =>
                setArquivos((prev) => [
                  ...prev,
                  ...Array.from(e.target.files ?? []),
                ])
              }
            />
          </label>
        </Tooltip>

        {/* Seletor de templates */}
        {templates && templates.length > 0 && (
          <SeletorDeTemplates
            templates={templates}
            onInserir={(t) => setTexto(t)}
          />
        )}

        {/* Input de texto */}
        <textarea
          ref={textareaRef}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? 'Digite sua mensagem...'}
          disabled={disabled}
          rows={1}
          className={cn(
            'min-h-10 flex-1 resize-none rounded-2xl border border-line bg-surface-sunken/55',
            'px-3.5 py-2.5 text-sm leading-relaxed text-text placeholder:text-text-faint',
            'focus:border-accent/45 focus:bg-surface focus:ring-4 focus:ring-accent/10 outline-none',
            'scrollbar-thin transition-colors-fast',
          )}
        />

        {/* Botao enviar */}
        <Botao
          variante="primario"
          tamanho="md"
          onClick={handleEnviar}
          disabled={disabled === true || (!texto.trim() && arquivos.length === 0)}
          iconeEsquerda={PaperPlaneRight}
          aria-label="Enviar mensagem"
        >
          <span className="max-sm:hidden">Enviar</span>
        </Botao>
      </div>

      <p className="ml-12 mt-1.5 text-[10px] font-medium text-text-faint max-sm:hidden">
        Enter para enviar, Shift+Enter para nova linha
      </p>
    </div>
  );
}
