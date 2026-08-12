'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSessao } from '../sessao';

/**
 * O botão `+` do inventário: Novo Agendamento, Adicionar Paciente,
 * Prof. de Saúde, Recepcionista.
 *
 * Os atalhos são filtrados pelo PAPEL do vínculo, e não apenas escondidos por
 * estilo: quem não pode conceder acesso não vê "adicionar recepcionista", e não
 * vê porque a rota também recusaria. Menu que oferece o que a API nega ensina o
 * usuário a não confiar na tela.
 */

interface Atalho {
  readonly id: string;
  readonly rotulo: string;
  readonly destino: string;
  readonly papeis: readonly string[];
}

const ATALHOS: readonly Atalho[] = [
  { id: 'agendamento', rotulo: 'Novo agendamento', destino: '/agenda?novo=1',
    papeis: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { id: 'paciente', rotulo: 'Adicionar paciente', destino: '/pacientes?novo=1',
    papeis: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { id: 'profissional', rotulo: 'Profissional de saúde', destino: '/configuracoes?novo=profissional',
    papeis: ['admin_clinico', 'diretor_tecnico'] },
  { id: 'recepcionista', rotulo: 'Recepcionista', destino: '/configuracoes?novo=recepcao',
    papeis: ['admin_clinico', 'diretor_tecnico'] },
];

export function AtalhosDeCriacao() {
  const router = useRouter();
  const { vinculoAtivo } = useSessao();
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  const visiveis = ATALHOS.filter((a) => a.papeis.includes(vinculoAtivo.role));

  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e: MouseEvent) => {
      if (caixa.current !== null && !caixa.current.contains(e.target as Node)) {
        setAberto(false);
      }
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  if (visiveis.length === 0) return null;

  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-haspopup="menu"
        aria-label="Criar"
        className="grid size-10 place-items-center rounded-full bg-accent text-xl font-medium text-accent-on transition hover:opacity-90"
      >
        +
      </button>

      {aberto && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-[var(--r-md)] border border-line bg-surface shadow-elev-2"
        >
          {visiveis.map((a) => (
            <button
              key={a.id}
              role="menuitem"
              type="button"
              onClick={() => { setAberto(false); router.push(a.destino); }}
              className="block w-full px-4 py-2.5 text-left text-sm transition hover:bg-surface-hover"
            >
              {a.rotulo}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
