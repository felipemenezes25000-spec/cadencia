"use client";

import * as RadixToast from "@radix-ui/react-toast";
import { motion } from "motion/react";
import { CheckCircle, XCircle, Warning, Info, X, type Icon as PhosphorIcon } from "@phosphor-icons/react";
import { cn } from "../lib/cn";

export type TipoToast = "sucesso" | "erro" | "aviso" | "info";
export interface ToastData { readonly id: string; readonly tipo: TipoToast; readonly mensagem: string; readonly duracao?: number; }
interface ToastItemProps { readonly data: ToastData; readonly onClose: () => void; }

const ICONES: Record<TipoToast, PhosphorIcon> = { sucesso: CheckCircle, erro: XCircle, aviso: Warning, info: Info };
const TONS: Record<TipoToast, { borda: string; icone: string; fundo: string }> = {
  sucesso: { borda: 'border-ok/18', icone: 'text-ok bg-ok-soft', fundo: 'from-ok-soft/55' },
  erro: { borda: 'border-danger/18', icone: 'text-danger bg-danger-soft', fundo: 'from-danger-soft/55' },
  aviso: { borda: 'border-warn/18', icone: 'text-warn bg-warn-soft', fundo: 'from-warn-soft/55' },
  info: { borda: 'border-accent/18', icone: 'text-accent bg-accent-soft', fundo: 'from-accent-soft/55' },
};

export function ToastItem({ data, onClose }: ToastItemProps) {
  const Icone = ICONES[data.tipo];
  const tom = TONS[data.tipo];
  return (
    <RadixToast.Root duration={data.duracao ?? 5000} onOpenChange={(open) => { if (!open) onClose(); }} data-testid={`toast-${data.tipo}`}>
      <motion.div
        initial={{ x: 30, y: 4, opacity: 0, scale: .97 }} animate={{ x: 0, y: 0, opacity: 1, scale: 1 }} exit={{ x: 20, opacity: 0, scale: .98 }}
        transition={{ type: "spring", damping: 26, stiffness: 340 }}
        className={cn('relative flex min-w-[280px] max-w-[420px] items-start gap-3 overflow-hidden rounded-[16px] border bg-gradient-to-r to-surface/96 p-3.5 shadow-[var(--elev-float)] backdrop-blur-xl pointer-events-auto', tom.borda, tom.fundo)}
      >
        <span aria-hidden className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-[10px]', tom.icone)}><Icone size={17} weight="fill" /></span>
        <RadixToast.Description className="min-w-0 flex-1 pt-1 text-[13px] font-medium leading-relaxed text-text">{data.mensagem}</RadixToast.Description>
        <RadixToast.Close aria-label="Fechar notificacao" className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-text-faint transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" data-testid="toast-fechar"><X size={14} weight="bold" /></RadixToast.Close>
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-[var(--aurora)] opacity-45" />
      </motion.div>
    </RadixToast.Root>
  );
}
