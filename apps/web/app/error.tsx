'use client';

import { WarningCircle } from '@phosphor-icons/react';
import { Botao } from '../src/ui/Botao';

export default function ErrorPage({ error, reset }: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <div className="cadencia-page grid min-h-[60vh] place-items-center">
      <section role="alert" className="w-full max-w-lg rounded-2xl border border-danger/20 bg-surface p-6 text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-xl bg-danger-soft text-danger"><WarningCircle size={23} aria-hidden /></span>
        <h1 className="mt-4 text-xl font-bold text-text">Não foi possível abrir esta tela</h1>
        <p className="mt-2 text-sm text-text-muted">O conteúdo não foi atualizado. Tente novamente; se o problema continuar, informe o código abaixo ao suporte.</p>
        {error.digest ? <p className="mt-3 font-mono text-xs text-text-faint">Código: {error.digest}</p> : null}
        <Botao className="mt-5" onClick={reset}>Tentar novamente</Botao>
      </section>
    </div>
  );
}
