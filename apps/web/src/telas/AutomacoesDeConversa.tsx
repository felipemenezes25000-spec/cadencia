// apps/web/src/telas/AutomacoesDeConversa.tsx
'use client';

import { useEffect, useState } from 'react';

export interface Automacao {
  readonly automationId: string;
  readonly nome: string;
  readonly descricao: string;
  readonly templateNome: string;
  readonly canal: 'whatsapp' | 'sms' | 'email';
  readonly timing: string;
  readonly ativa: boolean;
}

export interface AutomacoesDeConversaProps {
  readonly carregar: () => Promise<Automacao[]>;
  readonly aoAlternarAtiva: (automationId: string, novoEstado: boolean) => Promise<void>;
  readonly aoEditar: (automationId: string) => void;
}

export function AutomacoesDeConversa(p: AutomacoesDeConversaProps) {
  const [automacoes, setAutomacoes] = useState<Automacao[]>([]);

  useEffect(() => {
    void p.carregar().then(setAutomacoes);
  }, [p]);

  async function alternar(automationId: string, atual: boolean): Promise<void> {
    const novo = !atual;
    setAutomacoes((prev) => prev.map((a) =>
      a.automationId === automationId ? { ...a, ativa: novo } : a));
    try {
      await p.aoAlternarAtiva(automationId, novo);
    } catch {
      setAutomacoes((prev) => prev.map((a) =>
        a.automationId === automationId ? { ...a, ativa: atual } : a));
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
        Automacoes
      </h1>

      <ul aria-label="Lista de automacoes"
          style={{ listStyle: 'none', margin: 0, padding: 0,
                   border: 'var(--border)', borderRadius: 'var(--r-md)',
                   overflow: 'hidden', background: 'var(--surface)' }}>
        {automacoes.map((a) => (
          <li key={a.automationId}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              alignItems: 'center', gap: 'var(--s-4)',
              padding: `var(--s-5) var(--s-5)`,
              borderBottom: 'var(--border)',
            }}>
            <div onClick={() => p.aoEditar(a.automationId)}
              style={{ cursor: 'pointer', display: 'grid', gap: 'var(--s-1)' }}>
              <span style={{ fontWeight: 'var(--fw-medium)' }}>{a.nome}</span>
              <span style={{ fontSize: 'var(--fs-13)', color: 'var(--text-muted)' }}>
                <span>{a.timing}</span>
                <span>{` · `}</span>
                <span>{a.templateNome}</span>
                <span>{` · `}</span>
                <span>{a.canal}</span>
              </span>
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
                {a.descricao}
              </span>
            </div>
            <button type="button" role="switch" aria-checked={a.ativa}
              aria-label={`${a.nome} ${a.ativa ? 'ativa' : 'inativa'}`}
              onClick={() => { void alternar(a.automationId, a.ativa); }}
              style={{
                width: 44, height: 24, borderRadius: 'var(--r-full)',
                border: 'none', cursor: 'pointer', position: 'relative',
                background: a.ativa ? 'var(--accent)' : 'var(--surface-sunken)',
                transition: 'background var(--dur-1)',
              }}>
              <span aria-hidden="true" style={{
                position: 'absolute', top: 2,
                left: a.ativa ? 22 : 2,
                width: 20, height: 20, borderRadius: 'var(--r-full)',
                background: 'white', transition: 'left var(--dur-1)',
                boxShadow: '0 1px 2px oklch(0% 0 0 / .15)',
              }} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
