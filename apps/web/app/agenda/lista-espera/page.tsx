'use client';

import { useCallback, useEffect, useState } from 'react';
import { ListaDeEspera, type ItemDeEspera } from '../../../src/telas/ListaDeEspera';
import { PageHeader } from '../../../src/ui/PageHeader';
import { Botao } from '../../../src/ui/Botao';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from '@phosphor-icons/react';

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
  const router = useRouter();
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
        subtitulo="Pacientes disponíveis para antecipação ou encaixe"
        semBreadcrumb
        acoes={<Botao variante="secundario" iconeEsquerda={ArrowLeft} onClick={() => router.push('/agenda')}>Voltar à agenda</Botao>}
      />
      {itens.length === 0 && !carregando ? (
        <p className="text-sm text-text-muted">
          Ninguém na lista. Quando uma vaga abrir, quem está aqui é chamado por
          prioridade e tempo de espera.
        </p>
      ) : (
        <ListaDeEspera
          itens={itens}
          aoChamar={(waitlistId) => {
            // Chamar ENCERRA a entrada com motivo registrado. O CHECK da tabela
            // exige que `closed_at` e `close_reason` andem juntos — não existe
            // saída da fila sem explicação de por que a pessoa saiu.
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
