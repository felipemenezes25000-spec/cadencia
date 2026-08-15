'use client';

import { Buildings, Plus } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
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
    <section className="settings-org-section" aria-labelledby="estrutura-organizacao-titulo">
      <header className="settings-subsection-header">
        <div className="settings-subsection-header-copy">
          <h3 id="estrutura-organizacao-titulo">Estrutura da organização</h3>
          <p>Veja todas as unidades vinculadas ao mesmo ambiente Cadência.</p>
        </div>
        {podeCriar ? (
          <Botao variante="secundario" tamanho="sm" iconeEsquerda={Plus} onClick={aoCriar}>
            Nova unidade
          </Botao>
        ) : null}
      </header>

      {clinicas.length === 0 ? (
        <div className="settings-units-empty">Nenhuma unidade cadastrada.</div>
      ) : (
        <div className="settings-units-grid">
          {clinicas.map((clinica) => {
            const ativa = clinica.clinicId === clinicaAtivaId;
            return (
              <article key={clinica.clinicId} className={cn('settings-unit-card', ativa && 'is-active')}>
                <div className="settings-unit-card-top">
                  <span className="settings-unit-icon"><Buildings size={17} weight="duotone" aria-hidden /></span>
                  <div className="settings-unit-name">
                    <strong>{clinica.nome}</strong>
                    <span>{clinica.cnpj ? `CNPJ ${clinica.cnpj}` : 'Cadastro da unidade'}</span>
                  </div>
                  {ativa ? <span className="settings-unit-badge">Em uso</span> : null}
                </div>

                <div className="settings-unit-facts">
                  <div className="settings-unit-fact">
                    <span>CNES</span>
                    <strong>{clinica.cnes ?? 'Não informado'}</strong>
                  </div>
                  <div className="settings-unit-fact">
                    <span>Fuso</span>
                    <strong>{FUSOS_LABEL[clinica.timezone] ?? clinica.timezone}</strong>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
