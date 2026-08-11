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
  /** Rotulo visivel */
  readonly rotulo?: string;
  /** Texto de ajuda abaixo do campo */
  readonly ajuda?: string;
  /** @deprecated Use `ajuda` instead. Mantido para compatibilidade. */
  readonly dica?: string;
  /** Mensagem de erro (ativa estado de erro) */
  readonly erro?: string | undefined;
  /** Variante: input padrao ou textarea */
  readonly variante?: 'default' | 'textarea';
  /** Numero de linhas para textarea */
  readonly linhas?: number;
  /** Slot de prefixo (icone, simbolo) */
  readonly prefixo?: ReactNode;
  /** Slot de sufixo (icone, botao) */
  readonly sufixo?: ReactNode;
  /** @deprecated Use Tailwind sizing. Mantido para compatibilidade. */
  readonly denso?: boolean;
  /** Classes adicionais para o container */
  readonly className?: string;
}

const wrapperBase = [
  'flex items-center gap-2 rounded-lg border bg-surface px-3',
  'transition-colors-fast hover:border-line-strong',
].join(' ');

const wrapperFocus =
  'focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/10';

const wrapperError =
  'border-danger focus-within:border-danger focus-within:ring-danger';

const wrapperNormal = 'border-line';

const inputBase =
  'flex-1 bg-transparent py-2.5 text-sm text-text placeholder:text-text-faint outline-none disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Campo de entrada com suporte a forwardRef para react-hook-form,
 * variante textarea, prefixo/sufixo, e estados de feedback.
 */
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
    ]
      .filter((x): x is string => x !== null)
      .join(' ');

    const [charCount, setCharCount] = useState(() => {
      const initial = (value ?? defaultValue ?? '') as string;
      return initial.length;
    });

    function handleChange(
      e: ChangeEvent<HTMLInputElement> | ChangeEvent<HTMLTextAreaElement>,
    ) {
      if (maxLength != null) {
        setCharCount(e.target.value.length);
      }
      if (onChange) {
        onChange(e as ChangeEvent<HTMLInputElement>);
      }
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
      <div className={cn('flex flex-col gap-1', className)}>
        {rotulo && (
          <label
            htmlFor={id}
            className="text-xs font-semibold text-text-muted"
          >
            {rotulo}
          </label>
        )}

        <div className={wrapperClasses}>
          {prefixo && (
            <span className="shrink-0 text-text-muted" data-testid="campo-prefixo">
              {prefixo}
            </span>
          )}

          {variante === 'textarea' ? (
            <textarea
              ref={ref as React.Ref<HTMLTextAreaElement>}
              rows={linhas ?? 3}
              className={cn(inputBase, 'resize-y')}
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

          {sufixo && (
            <span className="shrink-0 text-text-muted" data-testid="campo-sufixo">
              {sufixo}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1">
            <AnimatePresence mode="wait">
              {temErro ? (
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
              ) : textoAjuda != null ? (
                <p key="ajuda" id={idAjuda} className="text-xs text-text-muted">
                  {textoAjuda}
                </p>
              ) : null}
            </AnimatePresence>
          </div>

          {showCounter && (
            <span
              className={cn(
                'ml-auto text-xs',
                nearMax ? 'text-danger' : 'text-text-muted',
              )}
              data-testid="campo-contador"
            >
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
