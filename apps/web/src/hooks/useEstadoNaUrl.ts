'use client';

import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';

function assinarMudancas(aoMudar: () => void) {
  window.addEventListener('popstate', aoMudar);
  return () => window.removeEventListener('popstate', aoMudar);
}

/** Mantém filtros textuais compartilháveis e compatíveis com voltar/avançar. */
export function useEstadoNaUrl(chave: string, valorInicial = ''): readonly [string, Dispatch<SetStateAction<string>>] {
  const valor = useSyncExternalStore(
    assinarMudancas,
    () => new URLSearchParams(window.location.search).get(chave) ?? valorInicial,
    () => valorInicial,
  );

  const definir = useCallback<Dispatch<SetStateAction<string>>>((proximo) => {
    const atual = new URLSearchParams(window.location.search).get(chave) ?? valorInicial;
    const resolvido = typeof proximo === 'function' ? proximo(atual) : proximo;
    const url = new URL(window.location.href);
    if (resolvido === valorInicial || resolvido === '') url.searchParams.delete(chave);
    else url.searchParams.set(chave, resolvido);
    window.history.replaceState(window.history.state, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, [chave, valorInicial]);

  return [valor, definir] as const;
}
