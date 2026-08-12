// apps/web/src/telas/TemplatesDeMensagem.tsx
'use client';

import { PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Botao } from '../ui/Botao';
import { Icone } from '../ui/Icone';
import { Tooltip } from '../ui/Tooltip';
import { PageHeader } from '../ui/PageHeader';

/* ── Tipos ──────────────────────────────────────────────────────────── */

export interface Template {
  readonly id: string;
  readonly titulo: string;
  readonly conteudo: string;
}

export interface TemplatesDeMensagemProps {
  /** Lista de templates a exibir */
  readonly templates: readonly Template[];
  /** Callback ao clicar em "Novo template" */
  readonly aoCriar: () => void;
  /** Callback ao clicar no botão editar de um template */
  readonly aoEditar: (id: string) => void;
  /** Callback ao clicar no botão excluir de um template */
  readonly aoExcluir: (id: string) => void;
}

/* ── Componente ─────────────────────────────────────────────────────── */

export function TemplatesDeMensagem({
  templates,
  aoCriar,
  aoEditar,
  aoExcluir,
}: TemplatesDeMensagemProps) {
  return (
    <div className="cadencia-page space-y-4">
      <PageHeader
        titulo="Templates de mensagem"
        semBreadcrumb
        acoes={
          <Botao variante="primario" iconeEsquerda={Plus} onClick={aoCriar}>
            Novo template
          </Botao>
        }
      />

      {templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-text-muted">
          <p className="text-sm">Nenhum template cadastrado</p>
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <div
              key={t.id}
              className={cn(
                'flex items-start justify-between',
                'rounded-[var(--r-lg)] border border-line',
                'bg-surface p-4 hover:bg-surface-raised transition-colors-fast',
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text">{t.titulo}</p>
                <p className="text-xs text-text-muted mt-1 line-clamp-2">
                  {t.conteudo}
                </p>
              </div>

              <div className="flex items-center gap-1 shrink-0 ml-4">
                <Tooltip conteudo="Editar">
                  <button
                    type="button"
                    onClick={() => aoEditar(t.id)}
                    className={cn(
                      'rounded-[var(--r-md)] p-1.5',
                      'text-text-muted hover:bg-surface-raised transition-colors-fast',
                    )}
                    aria-label={`Editar ${t.titulo}`}
                  >
                    <Icone icon={PencilSimple} size="sm" />
                  </button>
                </Tooltip>
                <Tooltip conteudo="Excluir">
                  <button
                    type="button"
                    onClick={() => aoExcluir(t.id)}
                    className={cn(
                      'rounded-[var(--r-md)] p-1.5',
                      'text-text-muted hover:text-danger hover:bg-danger/5',
                      'transition-colors-fast',
                    )}
                    aria-label={`Excluir ${t.titulo}`}
                  >
                    <Icone icon={Trash} size="sm" />
                  </button>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
