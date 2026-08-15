'use client';

import { Clock, Plus, Stethoscope } from '@phosphor-icons/react';
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
    <section className="settings-units" aria-labelledby="unidades-organizacao-titulo">
      <div className="settings-units-header">
        <div>
          <h3 id="unidades-organizacao-titulo">Estrutura da organização</h3>
          <p>Veja todas as unidades vinculadas ao mesmo ambiente Cadência.</p>
        </div>
        {podeCriar ? (
          <Botao variante="secundario" tamanho="sm" iconeEsquerda={Plus} onClick={aoCriar}>Nova unidade</Botao>
        ) : null}
      </div>

      {clinicas.length === 0 ? (
        <div className="rounded-[15px] border border-dashed border-line bg-surface-subtle p-6 text-center text-sm text-text-muted">
          Nenhuma unidade cadastrada.
        </div>
      ) : (
        <div className="settings-units-grid">
          {clinicas.map((clinica) => {
            const ativa = clinica.clinicId === clinicaAtivaId;
            return (
              <article key={clinica.clinicId} className={`settings-unit-card ${ativa ? 'is-active' : ''}`}>
                <div className="settings-unit-card-top">
                  <span className="settings-unit-icon"><Stethoscope size={18} weight="duotone" aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate">{clinica.nome}</h4>
                    <div className="settings-unit-card-meta">
                      <span><Clock size={11} aria-hidden />{FUSOS_LABEL[clinica.timezone] ?? clinica.timezone}</span>
                      <span>CNES {clinica.cnes ?? '—'}</span>
                      <span>CNPJ {clinica.cnpj ?? '—'}</span>
                    </div>
                  </div>
                  {ativa ? <span className="settings-unit-active-badge">Em uso</span> : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
