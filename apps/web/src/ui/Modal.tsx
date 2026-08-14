'use client';

import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from '@phosphor-icons/react';
import { BotaoIcone } from './BotaoIcone';

export type LarguraDeModal = 'sm' | 'md' | 'lg';

const LARGURA: Record<LarguraDeModal, string> = {
  sm: 'w-[min(400px,calc(100vw-32px))]',
  md: 'w-[min(520px,calc(100vw-32px))]',
  lg: 'w-[min(720px,calc(100vw-32px))]',
};

export interface ModalProps {
  readonly aberto: boolean;
  readonly titulo: string;
  /** Some do visual, mas continua no `aria-describedby` para leitor de tela. */
  readonly descricao?: string;
  readonly largura?: LarguraDeModal;
  /** Trava o fechamento enquanto uma submissão está em voo. */
  readonly ocupado?: boolean;
  readonly aoFechar: () => void;
  readonly children: ReactNode;
  /** Barra de ações. Fica fora do scroll para não sumir em formulário longo. */
  readonly rodape?: ReactNode;
}

/**
 * Modal de conteúdo — formulário, detalhe, qualquer coisa que não seja uma
 * pergunta de sim/não (para isso existe DialogoDeConfirmacao).
 *
 * Existe porque havia dois modais escritos à mão (ConvidarUsuario, CriarClinica)
 * que declaravam `role="dialog" aria-modal="true"` num `<div>` comum. Esse par de
 * atributos promete ao leitor de tela que o resto da página está inerte, mas sem
 * focus trap o Tab passeava pelo conteúdo de trás — a promessa era falsa, e a
 * navegação por teclado ficava pior do que se nada tivesse sido declarado.
 *
 * Radix resolve os quatro pontos de uma vez: prende o foco, devolve ao gatilho
 * ao fechar, fecha no Escape e marca o resto da árvore com `aria-hidden`.
 */
export function Modal({
  aberto,
  titulo,
  descricao,
  largura = 'md',
  ocupado = false,
  aoFechar,
  children,
  rodape,
}: ModalProps) {
  return (
    <Dialog.Root
      open={aberto}
      onOpenChange={(open) => { if (!open && !ocupado) aoFechar(); }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-modal)] bg-text/25 transition-opacity duration-200 data-[state=closed]:opacity-0 data-[state=open]:opacity-100" />
        <Dialog.Content
          className={[
            'fixed z-[calc(var(--z-modal)+1)] overflow-hidden border border-line bg-surface shadow-elev-3 focus:outline-none',
            /* Desktop: caixa centrada. */
            'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl',
            LARGURA[largura],
            'max-h-[calc(100dvh-48px)]',
            /* Celular: folha de baixo. Centrado com `top-1/2` o modal se
               ancora no viewport de LAYOUT, que nao encolhe quando o teclado
               do iOS abre — o rodape com Salvar/Cancelar ficava atras do
               teclado. Colado embaixo, ele sobe junto. */
            'max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:w-full max-md:max-w-none',
            'max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-2xl max-md:rounded-b-none',
            'max-md:max-h-[92dvh] max-md:pb-[env(safe-area-inset-bottom)]',
          ].join(' ')}
          /* Com descrição, Radix liga o `aria-describedby` sozinho e a prop não
             pode ser passada (passá-la como undefined apagaria o vínculo).
             Sem descrição, passar undefined é o opt-out documentado — sem isso
             o Radix loga aviso de acessibilidade em toda abertura. */
          {...(descricao === undefined ? { 'aria-describedby': undefined } : {})}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-bold text-text">{titulo}</Dialog.Title>
              {descricao === undefined ? null : (
                <Dialog.Description className="mt-1 text-sm leading-relaxed text-text-muted">
                  {descricao}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <BotaoIcone icone={X} rotulo="Fechar" disabled={ocupado} className="-mr-1" />
            </Dialog.Close>
          </div>

          <div className="max-h-[min(60dvh,520px)] overflow-y-auto scrollbar-thin px-5 py-4">
            {children}
          </div>

          {rodape === undefined ? null : (
            <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
              {rodape}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
