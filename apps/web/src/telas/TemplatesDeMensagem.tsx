// apps/web/src/telas/TemplatesDeMensagem.tsx
'use client';

import { ChatText, PencilSimple, Plus, Trash, BracketsCurly } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import { cn } from '../lib/cn';
import { Botao } from '../ui/Botao';
import { Icone } from '../ui/Icone';
import { Tooltip } from '../ui/Tooltip';
import { PageHeader } from '../ui/PageHeader';
import { EstadoVazio } from '../ui/EstadoVazio';

export interface Template { readonly id: string; readonly titulo: string; readonly conteudo: string; }
export interface TemplatesDeMensagemProps { readonly templates: readonly Template[]; readonly aoCriar: () => void; readonly aoEditar: (id: string) => void; readonly aoExcluir: (id: string) => void; }

export function TemplatesDeMensagem({ templates, aoCriar, aoEditar, aoExcluir }: TemplatesDeMensagemProps) {
  return (
    <div className="cadencia-page space-y-6">
      <PageHeader titulo="Templates de mensagem" subtitulo="Uma biblioteca de voz consistente para cada momento da jornada do paciente." semBreadcrumb acoes={<Botao variante="primario" iconeEsquerda={Plus} onClick={aoCriar}>Novo template</Botao>} />

      {templates.length === 0 ? (
        <EstadoVazio icone={ChatText} titulo="Nenhum template cadastrado" descricao="Crie mensagens reutilizáveis com variáveis para reduzir trabalho repetitivo." acao={<Botao variante="primario" iconeEsquerda={Plus} onClick={aoCriar}>Novo template</Botao>} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {templates.map((t, index) => {
            const variaveis = t.conteudo.match(/{{[^}]+}}/g)?.length ?? 0;
            return (
              <motion.article key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .045 }} className={cn('cadencia-panel group flex min-h-[156px] flex-col justify-between p-4 transition-[transform,box-shadow,border-color] duration-[var(--dur-2)] hover:-translate-y-0.5 hover:border-accent/20 hover:shadow-elev-2 sm:p-5')}>
                <div className="flex items-start gap-3"><span className="cadencia-icon-orb h-10 w-10 shrink-0"><ChatText size={18} weight="duotone" /></span><div className="min-w-0"><p className="m-0 truncate text-sm font-semibold tracking-[-.015em] text-text">{t.titulo}</p><p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-text-muted">{t.conteudo}</p></div></div>
                <div className="mt-5 flex items-center justify-between gap-3 border-t border-line/60 pt-3"><span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-text-faint"><BracketsCurly size={13} /> {variaveis} {variaveis === 1 ? 'variável' : 'variáveis'}</span><div className="flex items-center gap-1"><Tooltip conteudo="Editar"><button type="button" onClick={() => aoEditar(t.id)} className="grid h-8 w-8 place-items-center rounded-[9px] text-text-muted transition-colors hover:bg-surface-raised hover:text-text" aria-label={`Editar ${t.titulo}`}><Icone icon={PencilSimple} size="sm" /></button></Tooltip><Tooltip conteudo="Excluir"><button type="button" onClick={() => aoExcluir(t.id)} className="grid h-8 w-8 place-items-center rounded-[9px] text-text-muted transition-colors hover:bg-danger-soft hover:text-danger" aria-label={`Excluir ${t.titulo}`}><Icone icon={Trash} size="sm" /></button></Tooltip></div></div>
              </motion.article>
            );
          })}
        </div>
      )}
    </div>
  );
}
