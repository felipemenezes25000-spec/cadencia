'use client';

import { useId, type InputHTMLAttributes } from 'react';

export interface CampoProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  readonly rotulo: string;
  readonly dica?: string;
  readonly erro?: string;
  readonly denso?: boolean;
}

export function Campo({ rotulo, dica, erro, denso = false, ...resto }: CampoProps) {
  const id = useId();
  const idDica = `${id}-dica`;
  const idErro = `${id}-erro`;
  const descrito = [dica === undefined ? null : idDica, erro === undefined ? null : idErro]
    .filter((x): x is string => x !== null).join(' ');

  return (
    <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
      <label htmlFor={id} style={{
        fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
        lineHeight: 1.3, color: 'var(--text-muted)',
      }}>
        {rotulo}
      </label>
      <input
        id={id}
        {...resto}
        aria-invalid={erro !== undefined}
        aria-describedby={descrito === '' ? undefined : descrito}
        style={{
          height: denso ? 32 : 40, padding: `0 var(--s-4)`,
          border: erro === undefined ? 'var(--border)' : '1px solid var(--danger)',
          borderRadius: 'var(--r-md)', background: 'var(--surface)', color: 'var(--text)',
          fontSize: 'var(--fs-14)', fontFamily: 'var(--font-ui)',
          ...resto.style,
        }}
      />
      {dica === undefined ? null : (
        <span id={idDica} style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
          {dica}
        </span>
      )}
      {erro === undefined ? null : (
        <span id={idErro} style={{ fontSize: 'var(--fs-12)', color: 'var(--danger)' }}>
          {erro}
        </span>
      )}
    </div>
  );
}
