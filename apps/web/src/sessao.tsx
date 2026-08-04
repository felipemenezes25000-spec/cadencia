'use client';

import { createContext, useContext, type ReactNode } from 'react';

export interface Sessao {
  readonly clinicId: string;
  readonly csrfToken: string;
}

const SessaoCtx = createContext<Sessao | null>(null);

export function useSessao(): Sessao {
  const s = useContext(SessaoCtx);
  if (s === null) throw new Error('useSessao fora de SessaoProvider');
  return s;
}

export function SessaoProvider({ sessao, children }: { sessao: Sessao; children: ReactNode }) {
  return <SessaoCtx.Provider value={sessao}>{children}</SessaoCtx.Provider>;
}
