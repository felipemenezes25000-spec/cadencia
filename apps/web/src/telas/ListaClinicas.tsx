'use client';

import { Botao } from '../ui/Botao';

export interface ClinicaResumo {
  readonly clinicId: string;
  readonly nome: string;
  readonly cnpj: string | null;
  readonly cnes: string | null;
  readonly timezone: string;
}

export interface ListaClinicasProps {
  readonly clinicas: ClinicaResumo[];
  readonly clinicaAtivaId: string;
  readonly podeCriar: boolean;
  readonly aoCriar: () => void;
}

const FUSOS_LABEL: Record<string, string> = {
  'America/Sao_Paulo': 'Brasília',
  'America/Manaus': 'Manaus',
  'America/Cuiaba': 'Cuiabá',
  'America/Belem': 'Belém',
  'America/Fortaleza': 'Fortaleza',
  'America/Recife': 'Recife',
  'America/Rio_Branco': 'Rio Branco',
  'America/Noronha': 'Noronha',
};

export function ListaClinicas({ clinicas, clinicaAtivaId, podeCriar, aoCriar }: ListaClinicasProps) {
  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
          Todas as unidades
        </h2>
        {podeCriar && (
          <Botao variante="primario" tamanho="sm" onClick={aoCriar}>
            Criar unidade
          </Botao>
        )}
      </div>

      {clinicas.length === 0 ? (
        <p className="text-sm text-text-muted">Nenhuma unidade cadastrada.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-text-muted">
                <th className="pb-2 font-medium">Nome</th>
                <th className="pb-2 font-medium">CNES</th>
                <th className="pb-2 font-medium">Fuso</th>
              </tr>
            </thead>
            <tbody>
              {clinicas.map((c) => (
                <tr key={c.clinicId} className="border-b border-line/50">
                  <td className="py-2.5">
                    <span>{c.nome}</span>
                    {c.clinicId === clinicaAtivaId && (
                      <span className="ml-2 rounded bg-accent/10 px-1.5 py-0.5 text-xs text-accent">
                        ativa
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 font-mono text-text-muted">
                    {c.cnes ?? '—'}
                  </td>
                  <td className="py-2.5 text-text-muted">
                    {FUSOS_LABEL[c.timezone] ?? c.timezone}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
