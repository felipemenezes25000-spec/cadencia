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
import { cn } from '../lib/cn';

export interface CampoProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix' | 'size'> {
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

const wrapperBase = [
  'flex items-center gap-2.5 rounded-[10px] border bg-surface px-3 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.75)]',
  'transition-[border-color,background-color,box-shadow] duration-150 hover:border-line-strong hover:bg-surface-raised',
].join(' ');

const wrapperFocus = 'focus-within:border-accent focus-within:bg-surface focus-within:ring-4 focus-within:ring-accent/10 focus-within:shadow-elev-1';
const wrapperError = 'border-danger focus-within:border-danger focus-within:ring-danger/12';
const wrapperNormal = 'border-line';
const inputBase = 'min-w-0 flex-1 bg-transparent py-2.5 text-sm text-text placeholder:text-text-faint outline-none disabled:cursor-not-allowed disabled:opacity-50';

const Campo = forwardRef<HTMLInputElement | HTMLTextAreaElement, CampoProps>(
  function Campo(props, ref) {
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
    const descrito = [
      textoAjuda != null ? idAjuda : null,
      erro != null ? idErro : null,
    ].filter((x): x is string => x !== null).join(' ');

    const [charCount, setCharCount] = useState(() => {
      const initial = (value ?? defaultValue ?? '') as string;
      return initial.length;
    });

    function handleChange(e: ChangeEvent<HTMLInputElement> | ChangeEvent<HTMLTextAreaElement>) {
      if (maxLength != null) setCharCount(e.target.value.length);
      if (onChange) onChange(e as ChangeEvent<HTMLInputElement>);
    }

    const temErro = erro != null && erro !== '';
    const wrapperClasses = cn(
      wrapperBase,
      wrapperFocus,
      temErro ? wrapperError : wrapperNormal,
      denso && 'h-8',
    );

    const sharedInputProps = {
      id,
      'aria-invalid': temErro,
      'aria-describedby': descrito === '' ? undefined : descrito,
      maxLength,
      onChange: handleChange,
      ...(value !== undefined ? { value } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
    };

    const showCounter = maxLength != null;
    const nearMax = maxLength != null && charCount >= maxLength * 0.9;

    return (
      <div className={cn('flex flex-col gap-1.5', className)}>
        {rotulo && <label htmlFor={id} className="text-[13px] font-semibold text-text-secondary">{rotulo}</label>}

        <div className={wrapperClasses}>
          {prefixo && <span className="shrink-0 text-text-tertiary" data-testid="campo-prefixo">{prefixo}</span>}

          {variante === 'textarea' ? (
            <textarea
              ref={ref as React.Ref<HTMLTextAreaElement>}
              rows={linhas ?? 3}
              className={cn(inputBase, 'resize-y leading-relaxed')}
              {...(resto as unknown as TextareaHTMLAttributes<HTMLTextAreaElement>)}
              {...sharedInputProps}
            />
          ) : (
            <input
              ref={ref as React.Ref<HTMLInputElement>}
              className={cn(inputBase, denso ? 'py-1' : 'py-2')}
              {...resto}
              {...sharedInputProps}
            />
          )}

          {sufixo && <span className="shrink-0 text-text-tertiary" data-testid="campo-sufixo">{sufixo}</span>}
        </div>

        <div className="flex min-h-[18px] items-center gap-2">
          <div className="flex-1">
            <AnimatePresence mode="wait">
              {temErro ? (
                <motion.p
                  key="erro"
                  id={idErro}
                  initial={{ x: -3, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                  className="text-xs font-medium text-danger"
                  role="alert"
                >
                  {erro}
                </motion.p>
              ) : textoAjuda != null ? (
                <p key="ajuda" id={idAjuda} className="text-xs leading-relaxed text-text-tertiary">{textoAjuda}</p>
              ) : null}
            </AnimatePresence>
          </div>

          {showCounter && (
            <span className={cn('ml-auto text-xs tabular-nums', nearMax ? 'text-danger' : 'text-text-tertiary')} data-testid="campo-contador">
              {charCount}/{maxLength}
            </span>
          )}
        </div>
      </div>
    );
  },
);

export { Campo };
export type { CampoProps as CampoPropsType };