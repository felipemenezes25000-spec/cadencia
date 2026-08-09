'use client';

import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
  type ChangeEvent,
} from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { WarningCircle } from '@phosphor-icons/react';
import { cn } from '../lib/cn';

export interface CampoProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix' | 'size'> {
  readonly rotulo?: string;
  readonly ajuda?: string;
  /** @deprecated Use `ajuda` instead. */
  readonly dica?: string;
  readonly erro?: string | undefined;
  readonly variante?: 'default' | 'textarea';
  readonly linhas?: number;
  readonly prefixo?: ReactNode;
  readonly sufixo?: ReactNode;
  /** @deprecated Use Tailwind sizing. */
  readonly denso?: boolean;
  readonly className?: string;
}

const inputBase =
  'min-w-0 flex-1 bg-transparent text-[13px] font-medium text-text placeholder:font-normal placeholder:text-text-faint outline-none disabled:cursor-not-allowed disabled:opacity-50';

const Campo = forwardRef<HTMLInputElement | HTMLTextAreaElement, CampoProps>(function Campo(props, ref) {
  const {
    rotulo,
    ajuda,
    dica,
    erro,
    variante = 'default',
    linhas,
    prefixo,
    sufixo,
    denso = false,
    className,
    maxLength,
    onChange,
    defaultValue,
    value,
    ...resto
  } = props;

  const id = useId();
  const textoAjuda = ajuda ?? dica;
  const idAjuda = `${id}-ajuda`;
  const idErro = `${id}-erro`;
  const descrito = [textoAjuda != null ? idAjuda : null, erro != null ? idErro : null]
    .filter((x): x is string => x !== null)
    .join(' ');

  const [charCount, setCharCount] = useState(() => String(value ?? defaultValue ?? '').length);
  const temErro = erro != null && erro !== '';
  const showCounter = maxLength != null;
  const nearMax = maxLength != null && charCount >= maxLength * 0.9;

  function handleChange(e: ChangeEvent<HTMLInputElement> | ChangeEvent<HTMLTextAreaElement>) {
    if (maxLength != null) setCharCount(e.target.value.length);
    onChange?.(e as ChangeEvent<HTMLInputElement>);
  }

  const sharedInputProps = {
    id,
    'aria-invalid': temErro,
    'aria-describedby': descrito === '' ? undefined : descrito,
    maxLength,
    onChange: handleChange,
    ...(value !== undefined ? { value } : {}),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
  };

  return (
    <div className={cn('group/campo flex flex-col gap-1.5', className)}>
      {rotulo && (
        <label htmlFor={id} className="ml-0.5 text-[11px] font-bold uppercase tracking-[.075em] text-text-muted">
          {rotulo}
        </label>
      )}

      <div
        className={cn(
          'relative flex items-center gap-2 overflow-hidden rounded-[12px] border bg-surface/90 px-3',
          'shadow-[inset_0_1px_0_color-mix(in_oklab,var(--surface)_80%,white)] backdrop-blur-sm',
          'transition-[border-color,box-shadow,background-color] duration-[var(--dur-2)] ease-[var(--ease-out)]',
          'hover:border-line-strong hover:bg-surface',
          'focus-within:border-accent focus-within:bg-surface focus-within:ring-[3px] focus-within:ring-accent/10 focus-within:shadow-elev-1',
          temErro ? 'border-danger focus-within:border-danger focus-within:ring-danger/10' : 'border-line/90',
          denso ? 'min-h-8' : variante === 'textarea' ? 'items-start' : 'min-h-11',
        )}
      >
        <span aria-hidden className="pointer-events-none absolute inset-x-3 bottom-0 h-px scale-x-0 bg-[var(--aurora)] opacity-0 transition-all duration-[var(--dur-2)] group-focus-within/campo:scale-x-100 group-focus-within/campo:opacity-75" />
        {prefixo && <span className="shrink-0 text-text-faint transition-colors group-focus-within/campo:text-accent" data-testid="campo-prefixo">{prefixo}</span>}

        {variante === 'textarea' ? (
          <textarea
            ref={ref as React.Ref<HTMLTextAreaElement>}
            rows={linhas ?? 3}
            className={cn(inputBase, 'resize-y py-3 leading-relaxed')}
            {...(resto as unknown as TextareaHTMLAttributes<HTMLTextAreaElement>)}
            {...sharedInputProps}
          />
        ) : (
          <input
            ref={ref as React.Ref<HTMLInputElement>}
            className={cn(inputBase, denso ? 'py-1' : 'py-2.5')}
            {...resto}
            {...sharedInputProps}
          />
        )}

        {sufixo && <span className="shrink-0 text-text-muted" data-testid="campo-sufixo">{sufixo}</span>}
      </div>

      <div className="flex min-h-[16px] items-start gap-2 px-0.5">
        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            {temErro ? (
              <motion.p
                key="erro"
                id={idErro}
                initial={{ y: -2, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="m-0 flex items-center gap-1 text-[11px] font-medium text-danger"
                role="alert"
              >
                <WarningCircle size={12} weight="fill" aria-hidden /> {erro}
              </motion.p>
            ) : textoAjuda != null ? (
              <motion.p key="ajuda" id={idAjuda} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="m-0 text-[11px] leading-relaxed text-text-faint">
                {textoAjuda}
              </motion.p>
            ) : null}
          </AnimatePresence>
        </div>
        {showCounter && <span className={cn('ml-auto text-[10px] tabular-nums', nearMax ? 'font-semibold text-danger' : 'text-text-faint')} data-testid="campo-contador">{charCount}/{maxLength}</span>}
      </div>
    </div>
  );
});

export { Campo };
export type { CampoProps as CampoPropsType };
