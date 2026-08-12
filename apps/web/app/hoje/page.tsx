'use client';

import { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryState, parseAsStringLiteral } from 'nuqs';
import { Hoje, type LinhaDaFila, type PrecisaDeVoce } from '../../src/telas/Hoje';
import type { Contadores, FiltroDoDia } from '../../src/ui/FaixaDeContadores';
import { apiFetch } from '../../src/api';
import { useSessao } from '../../src/sessao';
import { diaNaClinica } from '../../src/lib/fuso';
import { PainelDoDia } from '../../src/ui/PainelDoDia';
import { AtalhosDeCriacao } from '../../src/ui/AtalhosDeCriacao';

const FILTROS = ['agendados', 'confirmados', 'aguardando', 'atendidos', 'faltas'] as const;

function HojeInner() {
  const router = useRouter();
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();
  const [filtro, setFiltro] = useQueryState('faceta', parseAsStringLiteral(FILTROS));
  const FUSO = vinculoAtivo.timezone;
  // "Hoje" é o hoje DA CLÍNICA. `toISOString()` dá a data em UTC, então no
  // Brasil (UTC-3) a tela virava de dia às 21h: a recepção perdia de vista as
  // consultas que ainda faltavam atender, três horas antes da meia-noite.
  const dia = diaNaClinica(new Date().toISOString(), FUSO);

  /**
   * Abre o atendimento da linha da fila.
   *
   * Se já existe encontro, ENTRA nele. Criar um segundo para o mesmo
   * agendamento partiria o registro do dia em duas versões seladas distintas, e
   * nenhuma delas seria "a consulta" — o que quebra a leitura do prontuário e a
   * cobrança. Por isso o `encounterId` da fila manda, e não o botão.
   */
  async function abrirAtendimento(l: LinhaDaFila): Promise<void> {
    if (l.encounterId !== null) { router.push(`/atendimento/${l.encounterId}`); return; }
    const r = await apiFetch<{ encounterId: string }>('/v1/atendimentos', {
      method: 'POST',
      body: { patientId: l.patientId, appointmentId: l.appointmentId },
      clinicId, csrfToken,
    });
    router.push(`/atendimento/${r.encounterId}`);
  }

  return (
    <>
      {/* O `+` flutua sobre a tela: é ação de criação, não conteúdo do dia, e
          por isso não entra no fluxo da fila. */}
      <div className="fixed bottom-6 right-6 z-20 md:bottom-8 md:right-8">
        <AtalhosDeCriacao />
      </div>

      <Hoje
      dia={dia}
      timezone={FUSO}
      {...(filtro === null ? {} : { filtro: filtro as FiltroDoDia })}
      aoMudarFiltro={(f) => { void setFiltro(f ?? null); }}
      carregarDia={(d, f) => apiFetch<{ contadores: Contadores; fila: LinhaDaFila[] }>(
        `/v1/agenda/dia?dia=${d}${f === undefined ? '' : `&status=${mapa(f)}`}`,
        { clinicId, csrfToken })}
      carregarPrecisaDeVoce={() => apiFetch<PrecisaDeVoce>(
        '/v1/agenda/precisa-de-voce', { clinicId, csrfToken })}
      aoCheckIn={async (id) => {
        await apiFetch(`/v1/agenda/agendamentos/${id}/checkin`,
          { method: 'POST', clinicId, csrfToken });
      }}
      aoAbrirAtendimento={(l) => { void abrirAtendimento(l); }}
      mensagensNaoLidasTotal={0}
      aoMensagem={() => {}}
      aoCobrar={() => {}}
      />
      <PainelDoDia />
    </>
  );
}

export default function PaginaHoje() {
  return (
    <Suspense>
      <HojeInner />
    </Suspense>
  );
}

/**
 * Faceta da tela -> valor do enum `status` da rota.
 *
 * 'agendados' devolvia STRING VAZIA, e a rota valida `status` com
 * `z.enum([...])`: `&status=` não casa com nenhum membro e a requisição morria
 * em 400. Como a tela não trata a rejeição, ela continuava exibindo o resultado
 * do filtro anterior — clicar em "Agendados" parecia não fazer nada, ou pior,
 * mostrava a lista de outra faceta como se fosse essa.
 */
function mapa(f: FiltroDoDia): string {
  return f === 'agendados' ? 'agendado' : f === 'faltas' ? 'faltou'
    : f === 'confirmados' ? 'confirmado' : f === 'atendidos' ? 'atendido' : 'aguardando';
}
