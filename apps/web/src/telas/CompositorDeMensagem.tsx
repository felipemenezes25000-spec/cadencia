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
              'rounded-[var(--r-md)] p-2 text-text-muted',
              'hover:bg-surface-raised transition-colors-fast',
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
            'z-50 w-72 max-h-60 overflow-y-auto',
            'rounded-[var(--r-md)] border border-line',
            'bg-surface shadow-elev-2 p-1 scrollbar-thin',
          )}
        >
          {templates.map((t) => (
            <DropdownMenu.Item
              key={t.id}
              onSelect={() => onInserir(t.conteudo)}
              className={cn(
                'rounded-[var(--r-sm)] px-3 py-2 text-left cursor-pointer outline-none',
                'data-[highlighted]:bg-accent data-[highlighted]:text-accent-on',
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
    <div className="border-t border-line bg-surface px-4 py-3">
      {/* Preview de arquivos anexados */}
      {arquivos.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2" data-testid="arquivos-preview">
          {arquivos.map((f, i) => (
            <div
              key={`${f.name}-${i}`}
              className={cn(
                'flex items-center gap-1.5',
                'rounded-[var(--r-md)] bg-surface-raised px-2 py-1 text-xs',
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
              'cursor-pointer rounded-[var(--r-md)] p-2',
              'text-text-muted hover:bg-surface-raised transition-colors-fast',
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
            'flex-1 resize-none rounded-[var(--r-lg)] border border-line bg-surface-raised',
            'px-3 py-2 text-sm text-text placeholder:text-text-muted',
            'focus:border-accent focus:ring-1 focus:ring-accent outline-none',
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

      <p className="text-[length:var(--fs-11)] text-text-muted mt-1">
        Enter para enviar, Shift+Enter para nova linha
      </p>
    </div>
  );
}
