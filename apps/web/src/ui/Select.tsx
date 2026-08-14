'use client';

import { useId } from 'react';
import * as RadixSelect from '@radix-ui/react-select';
import { CaretDown, Check } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/cn';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

export interface SelectProps {
  /** Rótulo visível */
  readonly rotulo?: string;
  /** Placeholder quando nada selecionado */
  readonly placeholder?: string;
  /** Opções simples */
  readonly opcoes?: SelectOption[];
  /** Opções agrupadas */
  readonly grupos?: SelectGroup[];
  /** Valor atual */
  readonly value?: string;
  /** Callback de mudança */
  readonly onChange?: (value: string) => void;
  /** Mensagem de erro */
  readonly erro?: string;
  /** Desabilitado */
  readonly disabled?: boolean;
  /** Nome do campo (para formulários) */
  readonly name?: string;
  /** Classes adicionais */
  readonly className?: string;
}

const triggerBase = [
  'cadencia-select-trigger flex h-10 w-full items-center justify-between gap-2 rounded-[10px] border bg-surface px-3 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.75)]',
  'text-sm text-text',
  'transition-all-fast hover:border-line-strong hover:bg-surface-raised',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ');

const triggerFocus =
  'focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10 focus:shadow-elev-1 focus:outline-none';

const triggerError =
  'border-danger focus:border-danger focus:ring-danger';

/* Ver Campo.tsx: contorno de controle carrega affordance, exige 3:1. */
const triggerNormal = 'border-line-field';

function SelectItem({ value, label, disabled = false }: SelectOption) {
  return (
    <RadixSelect.Item
      value={value}
      disabled={disabled}
      className={cn(
        'relative flex cursor-pointer select-none items-center rounded-lg px-3 py-2 pr-8 text-sm text-text',
        'outline-none',
        'data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      )}
    >
      <RadixSelect.ItemText>{label}</RadixSelect.ItemText>
      <RadixSelect.ItemIndicator className="absolute right-2 flex items-center">
        <Check size={14} weight="bold" aria-hidden />
      </RadixSelect.ItemIndicator>
    </RadixSelect.Item>
  );
}

export function Select({
  rotulo,
  placeholder = 'Selecione...',
  opcoes,
  grupos,
  value,
  onChange,
  erro,
  disabled,
  name,
  className,
}: SelectProps) {
  const id = useId();
  const idRotulo = `${id}-rotulo`;
  const idErro = `${id}-erro`;
  const temErro = erro != null && erro !== '';

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {rotulo && (
        <label
          id={idRotulo}
          className="text-xs font-semibold text-text-muted"
        >
          {rotulo}
        </label>
      )}

      <RadixSelect.Root
        {...(value != null ? { value } : {})}
        {...(onChange != null ? { onValueChange: onChange } : {})}
        {...(disabled != null ? { disabled } : {})}
        {...(name != null ? { name } : {})}
      >
        <RadixSelect.Trigger
          className={cn(
            triggerBase,
            triggerFocus,
            temErro ? triggerError : triggerNormal,
          )}
          aria-labelledby={rotulo ? idRotulo : undefined}
          aria-invalid={temErro}
          aria-describedby={temErro ? idErro : undefined}
        >
          <RadixSelect.Value placeholder={placeholder} />
          <RadixSelect.Icon className="shrink-0 text-text-muted">
            <CaretDown size={16} weight="bold" aria-hidden />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>

        <RadixSelect.Portal>
          <RadixSelect.Content
            className={cn(
              'z-[var(--z-popover)] overflow-hidden rounded-xl border border-line bg-surface shadow-elev-3',
              'data-[state=open]:animate-[scaleIn_150ms_ease]',
              'data-[state=closed]:animate-[fadeOut_100ms_ease]',
            )}
            position="popper"
            sideOffset={6}
            align="start"
          >
            <RadixSelect.ScrollUpButton className="flex h-6 cursor-default items-center justify-center bg-surface text-text-muted">
              <CaretDown size={14} className="rotate-180" aria-hidden />
            </RadixSelect.ScrollUpButton>

            <RadixSelect.Viewport className="p-1 max-h-60 overflow-y-auto scrollbar-thin">
              {opcoes?.map((opcao) => (
                <SelectItem key={opcao.value} {...opcao} />
              ))}

              {grupos?.map((grupo, i) => (
                <RadixSelect.Group key={grupo.label}>
                  {i > 0 && (
                    <RadixSelect.Separator className="mx-1 my-1 h-px bg-line" />
                  )}
                  <RadixSelect.Label className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
                    {grupo.label}
                  </RadixSelect.Label>
                  {grupo.options.map((opcao) => (
                    <SelectItem key={opcao.value} {...opcao} />
                  ))}
                </RadixSelect.Group>
              ))}
            </RadixSelect.Viewport>

            <RadixSelect.ScrollDownButton className="flex h-6 cursor-default items-center justify-center bg-surface text-text-muted">
              <CaretDown size={14} aria-hidden />
            </RadixSelect.ScrollDownButton>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>

      <AnimatePresence mode="wait">
        {temErro && (
          <motion.p
            key="erro"
            id={idErro}
            initial={{ x: -4, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="text-xs text-danger"
            role="alert"
          >
            {erro}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
