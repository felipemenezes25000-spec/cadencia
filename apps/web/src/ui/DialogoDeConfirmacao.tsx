'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { WarningCircle, X } from '@phosphor-icons/react';
import { Botao } from './Botao';
import { BotaoIcone } from './BotaoIcone';

export interface DialogoDeConfirmacaoProps {
  readonly aberto: boolean;
  readonly titulo: string;
  readonly descricao: string;
  readonly confirmarRotulo: string;
  readonly carregando?: boolean;
  readonly erro?: string | null;
  readonly destrutivo?: boolean;
  readonly aoConfirmar: () => void;
  readonly aoFechar: () => void;
}

/**
 * Confirma uma mudança relevante sem recorrer a `window.confirm`.
 * Radix mantém foco preso, fecha com Escape e devolve o foco ao gatilho.
 */
export function DialogoDeConfirmacao({
  aberto,
  titulo,
  descricao,
  confirmarRotulo,
  carregando = false,
  erro,
  destrutivo = false,
  aoConfirmar,
  aoFechar,
}: DialogoDeConfirmacaoProps) {
  return (
    <Dialog.Root open={aberto} onOpenChange={(open) => { if (!open && !carregando) aoFechar(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-modal)] bg-text/25 data-[state=closed]:opacity-0 data-[state=open]:opacity-100 transition-opacity duration-200" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[calc(var(--z-modal)+1)] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface p-5 shadow-elev-3 focus:outline-none">
          <div className="flex items-start gap-3">
            <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${destrutivo ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'}`}>
              <WarningCircle size={20} weight="fill" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-bold text-text">{titulo}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-relaxed text-text-muted">{descricao}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <BotaoIcone icone={X} rotulo="Fechar" disabled={carregando} className="-mr-1 -mt-1" />
            </Dialog.Close>
          </div>

          {erro ? <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{erro}</p> : null}

          {/* flex-wrap: dois rotulos em portugues ("Cancelar" + "Confirmar
              cancelamento") estouram 343px numa linha so. */}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Dialog.Close asChild>
              <Botao variante="secundario" disabled={carregando}>Cancelar</Botao>
            </Dialog.Close>
            <Botao
              variante={destrutivo ? 'perigo' : 'primario'}
              carregando={carregando}
              onClick={aoConfirmar}
            >
              {confirmarRotulo}
            </Botao>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
