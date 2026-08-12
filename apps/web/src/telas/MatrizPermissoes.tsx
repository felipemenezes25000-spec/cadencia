'use client';
import { useMemo } from 'react';
import { Check, ShieldCheck } from '@phosphor-icons/react';
import { ACTIONS, ROLES, type ActionDef, type Role } from '@cadencia/authz';

const ROTULO_ROLE: Record<Role, string> = {
  admin_clinico: 'Administração',
  diretor_tecnico: 'Direção técnica',
  profissional: 'Profissional',
  recepcao: 'Recepção',
  financeiro: 'Financeiro',
};

function agrupar(actions: readonly ActionDef[]): Map<string, ActionDef[]> {
  const grupos = new Map<string, ActionDef[]>();
  for (const a of actions) {
    const dominio = a.key.split('.')[0]!;
    const lista = grupos.get(dominio) ?? [];
    lista.push(a);
    grupos.set(dominio, lista);
  }
  return grupos;
}

export function MatrizPermissoes() {
  const grupos = useMemo(() => agrupar(ACTIONS), []);
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[800px] text-sm">
        <thead className="bg-surface-2 text-left text-xs uppercase text-text-muted">
          <tr>
            <th className="w-80 px-4 py-2.5 font-medium">Ação</th>
            {ROLES.map((r) => <th key={r} className="px-3 py-2.5 text-center font-medium">{ROTULO_ROLE[r]}</th>)}
          </tr>
        </thead>
        <tbody>
          {[...grupos.entries()].map(([dominio, acoes]) => (
            <GroupFragment key={dominio} dominio={dominio} acoes={acoes} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupFragment({ dominio, acoes }: { readonly dominio: string; readonly acoes: readonly ActionDef[] }) {
  return (
    <>
      <tr className="bg-surface/80">
        <td colSpan={ROLES.length + 1} className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-text-faint">{dominio}</td>
      </tr>
      {acoes.map((a) => (
        <tr key={a.key} className="border-t border-line">
          <td className="px-4 py-2.5">
            <span className="flex items-center gap-2">
              <span className="font-medium">{a.description}</span>
              {a.requiresMfa && <span className="flex items-center gap-0.5 rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-bold text-warning"><ShieldCheck size={12} /> MFA</span>}
            </span>
            <span className="block text-[11px] text-text-faint font-mono">{a.key}</span>
          </td>
          {ROLES.map((role) => (
            <td key={role} className="px-3 py-2.5 text-center">
              {a.roles.includes(role)
                ? <Check size={16} weight="bold" className="mx-auto text-ok" aria-label="Permitido" />
                : <span className="text-text-faint" aria-label="Negado">--</span>}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
