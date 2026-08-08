"use client";

import * as RadixToast from "@radix-ui/react-toast";
import { motion } from "motion/react";
import {
  CheckCircle,
  XCircle,
  Warning,
  Info,
  X,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { cn } from "../lib/cn";

export type TipoToast = "sucesso" | "erro" | "aviso" | "info";

export interface ToastData {
  readonly id: string;
  readonly tipo: TipoToast;
  readonly mensagem: string;
  readonly duracao?: number;
}

interface ToastItemProps {
  readonly data: ToastData;
  readonly onClose: () => void;
}

const ICONES: Record<TipoToast, PhosphorIcon> = {
  sucesso: CheckCircle,
  erro: XCircle,
  aviso: Warning,
  info: Info,
};

const COR_BORDA: Record<TipoToast, string> = {
  sucesso: "border-l-ok",
  erro: "border-l-danger",
  aviso: "border-l-warn",
  info: "border-l-accent",
};

const COR_ICONE: Record<TipoToast, string> = {
  sucesso: "text-ok",
  erro: "text-danger",
  aviso: "text-warn",
  info: "text-accent",
};

export function ToastItem({ data, onClose }: ToastItemProps) {
  const Icone = ICONES[data.tipo];

  return (
    <RadixToast.Root
      duration={data.duracao ?? 5000}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      data-testid={`toast-${data.tipo}`}
    >
      <motion.div
        initial={{ x: 100, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: "spring", damping: 20, stiffness: 300 }}
        className={cn(
          "bg-surface border border-line border-l-4 rounded-md shadow-elev-2",
          "p-3 flex items-start gap-3",
          "pointer-events-auto",
          COR_BORDA[data.tipo],
        )}
      >
        <span
          className={cn("mt-px shrink-0", COR_ICONE[data.tipo])}
          aria-hidden="true"
        >
          <Icone size={20} weight="fill" />
        </span>

        <RadixToast.Description className="flex-1 text-[length:var(--fs-14)] leading-[var(--lh-ui)] text-text">
          {data.mensagem}
        </RadixToast.Description>

        <RadixToast.Close
          aria-label="Fechar notificacao"
          className={cn(
            "shrink-0 mt-px p-0.5 rounded-[var(--r-sm)]",
            "text-text-muted hover:text-text hover:bg-surface-hover",
            "transition-colors duration-[var(--dur-2)]",
            "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
          )}
          data-testid="toast-fechar"
        >
          <X size={16} weight="bold" />
        </RadixToast.Close>
      </motion.div>
    </RadixToast.Root>
  );
}
