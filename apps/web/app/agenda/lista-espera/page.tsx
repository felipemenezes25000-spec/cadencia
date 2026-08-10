'use client';

import { useCallback, useEffect, useState } from 'react';
import { ListaDeEspera, type ItemDeEspera } from '../../../src/telas/ListaDeEspera';
import { PageHeader } from '../../../src/ui/PageHeader';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';

interface ItemDaApi {
  waitlistId: string;
  patientId: string;
  patientNome: string;
  prioridade: 'baixa' | 'normal' | 'alta' | 'urgente';
  observacao: string | null;
  esperandoDesde: string;
  chamadaEm: string | null;
}

export default function PaginaListaDeEspera() {
  const { clinicId, csrfToken } = useSessao();
  const [itens, setItens] = useState<readonly ItemDeEspera[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    const r = await apiFetch<{ itens: ItemDaApi[] }>(
      '/v1/agenda/lista-espera', { clinicId, csrfToken });
    setItens(r.itens.map((x) => ({
      waitlistId: x.waitlistId,
      patientId: x.patientId,
      displayName: x.patientNome,
      prioridade: x.prioridade,
      esperandoDesde: x.esperandoDesde,
      observacao: x.observacao,
    })));
    setCarregando(false);
  }, [clinicId, csrfToken]);

  useEffect(() => { void carregar(); }, [carregar]);

  return (
    <div className="cadencia-page grid gap-6">
      <PageHeader
        titulo="Lista de espera"
        subtitulo={carregando ? 'Carregando…'
          : `${itens.length} ${itens.length === 1 ? 'pessoa' : 'pessoas'} aguardando vaga`}
      />

      {itens.length === 0 && !carregando ? (
        <p className="text-sm text-text-muted">
          Ninguem na lista. Quando uma vaga abrir, quem esta aqui e chamado por
          prioridade e tempo de espera.
        </p>
      ) : (
        <ListaDeEspera
          itens={itens}
          aoChamar={(waitlistId) => {
            // Chamar ENCERRA a entrada com motivo registrado. O CHECK da tabela
            // exige que `closed_at` e `close_reason` andem juntos — nao existe
            // saida da fila sem explicacao de por que a pessoa saiu.
            void apiFetch(`/v1/agenda/lista-espera/${waitlistId}`, {
              method: 'DELETE', body: { motivo: 'chamado para encaixe' },
              clinicId, csrfToken,
            }).then(carregar);
          }}
        />
      )}
    </div>
  );
}
