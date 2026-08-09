'use client';

import { useId } from 'react';
import * as RadixSelect from '@radix-ui/react-select';
import { CaretDown, Check, WarningCircle } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/cn';

export interface SelectOption { value: string; label: string; disabled?: boolean; }
export interface SelectGroup { label: string; options: SelectOption[]; }
export interface SelectProps {
  readonly rotulo?: string;
  readonly placeholder?: string;
  readonly opcoes?: SelectOption[];
  readonly grupos?: SelectGroup[];
  readonly value?: string;
  readonly onChange?: (value: string) => void;
  readonly erro?: string;
  readonly disabled?: boolean;
  readonly name?: string;
  readonly className?: string;
}

function SelectItem({ value, label, disabled = false }: SelectOption) {
  return (
    <RadixSelect.Item
      value={value}
      disabled={disabled}
      className={cn(
        'relative flex min-h-9 cursor-pointer select-none items-center rounded-[10px] px-3 py-2 pr-9 text-[13px] font-medium text-text outline-none',
        'transition-colors duration-[var(--dur-2)] data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
      )}
    >
      <RadixSelect.ItemText>{label}</RadixSelect.ItemText>
      <RadixSelect.ItemIndicator className="absolute right-2.5 grid h-5 w-5 place-items-center rounded-md bg-accent text-accent-on shadow-elev-1">
        <Check size={12} weight="bold" aria-hidden />
      </RadixSelect.ItemIndicator>
    </RadixSelect.Item>
  );
}

export function Select({ rotulo, placeholder = 'Selecione...', opcoes, grupos, value, onChange, erro, disabled, name, className }: SelectProps) {
  const id = useId();
  const idRotulo = `${id}-rotulo`;
  const idErro = `${id}-erro`;
  const temErro = erro != null && erro !== '';

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {rotulo && <label id={idRotulo} className="ml-0.5 text-[11px] font-bold uppercase tracking-[.075em] text-text-muted">{rotulo}</label>}
      <RadixSelect.Root
        {...(value != null ? { value } : {})}
        {...(onChange != null ? { onValueChange: onChange } : {})}
        {...(disabled != null ? { disabled } : {})}
        {...(name != null ? { name } : {})}
      >
        <RadixSelect.Trigger
          className={cn(
            'group flex min-h-11 w-full items-center justify-between gap-2 rounded-[12px] border bg-surface/90 px-3 text-[13px] font-medium text-text',
            'shadow-[inset_0_1px_0_color-mix(in_oklab,var(--surface)_80%,white)] transition-[border-color,box-shadow,background-color] duration-[var(--dur-2)]',
            'hover:border-line-strong hover:bg-surface focus:outline-none focus:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
            temErro ? 'border-danger focus:border-danger focus:ring-danger/10' : 'border-line/90 focus:border-accent focus:ring-accent/10',
          )}
          aria-labelledby={rotulo ? idRotulo : undefined}
          aria-invalid={temErro}
          aria-describedby={temErro ? idErro : undefined}
        >
          <RadixSelect.Value placeholder={placeholder} />
          <RadixSelect.Icon className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-surface-sunken/70 text-text-faint transition-colors group-data-[state=open]:bg-accent-soft group-data-[state=open]:text-accent">
            <CaretDown size={14} weight="bold" aria-hidden />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>

        <RadixSelect.Portal>
          <RadixSelect.Content
            className="z-[var(--z-popover)] overflow-hidden rounded-[16px] border border-line/75 bg-surface/97 p-1 shadow-[var(--elev-float)] backdrop-blur-xl data-[state=open]:animate-[scaleIn_150ms_var(--ease-out)] data-[state=closed]:animate-[fadeOut_100ms_ease]"
            position="popper" sideOffset={6} align="start"
          >
            <RadixSelect.ScrollUpButton className="flex h-7 cursor-default items-center justify-center text-text-faint"><CaretDown size={13} className="rotate-180" aria-hidden /></RadixSelect.ScrollUpButton>
            <RadixSelect.Viewport className="max-h-64 min-w-[var(--radix-select-trigger-width)] overflow-y-auto p-0.5 scrollbar-thin">
              {opcoes?.map((opcao) => <SelectItem key={opcao.value} {...opcao} />)}
              {grupos?.map((grupo, i) => (
                <RadixSelect.Group key={grupo.label}>
                  {i > 0 && <RadixSelect.Separator className="mx-2 my-1.5 h-px bg-line/70" />}
                  <RadixSelect.Label className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-[.1em] text-text-faint">{grupo.label}</RadixSelect.Label>
                  {grupo.options.map((opcao) => <SelectItem key={opcao.value} {...opcao} />)}
                </RadixSelect.Group>
              ))}
            </RadixSelect.Viewport>
            <RadixSelect.ScrollDownButton className="flex h-7 cursor-default items-center justify-center text-text-faint"><CaretDown size={13} aria-hidden /></RadixSelect.ScrollDownButton>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>

      <AnimatePresence mode="wait" initial={false}>
        {temErro && (
          <motion.p key="erro" id={idErro} initial={{ y: -2, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .15 }} className="m-0 flex items-center gap-1 px-0.5 text-[11px] font-medium text-danger" role="alert">
            <WarningCircle size={12} weight="fill" aria-hidden />{erro}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
