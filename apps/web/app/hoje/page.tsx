'use client';

import { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import {
  Hoje,
  type ContadoresDoDia,
  type FiltroDoFluxo,
  type LinhaDaFila,
  type PrecisaDeVoce,
} from '../../src/telas/Hoje';
import type { PatientQuickSummary } from '../../src/components/patients/PatientQuickView';
import { apiFetch } from '../../src/api';
import { diaNaClinica } from '../../src/lib/fuso';
import { useSessao } from '../../src/sessao';

const FILTROS = ['espera', 'atendimento', 'agendados', 'concluidos'] as const;

interface PacienteDaApi {
  readonly patientId: string;
  readonly displayName: string;
  readonly legalName: string;
  readonly birthDate: string | null;
  readonly phonePrimary: string | null;
  readonly email: string | null;
  readonly cadastroStatus: 'completo' | 'preliminar';
}

function HojeInner() {
  const router = useRouter();
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();
  const [filtro, setFiltro] = useQueryState('fluxo', parseAsStringLiteral(FILTROS));
  const timezone = vinculoAtivo.timezone;
  const dia = diaNaClinica(new Date().toISOString(), timezone);

  async function abrirAtendimento(linha: LinhaDaFila): Promise<void> {
    if (linha.encounterId !== null) {
      router.push(`/atendimentos/${linha.encounterId}`);
      return;
    }
    const resposta = await apiFetch<{ encounterId: string }>('/v1/atendimentos', {
      method: 'POST',
      body: { patientId: linha.patientId, appointmentId: linha.appointmentId },
      clinicId,
      csrfToken,
    });
    router.push(`/atendimentos/${resposta.encounterId}`);
  }

  return (
    <Hoje
      dia={dia}
      timezone={timezone}
      {...(filtro === null ? {} : { filtro: filtro as FiltroDoFluxo })}
      aoMudarFiltro={(next) => { void setFiltro(next ?? null); }}
      carregarDia={(data) => apiFetch<{ contadores: ContadoresDoDia; fila: LinhaDaFila[] }>(
        `/v1/agenda/dia?dia=${data}`,
        { clinicId, csrfToken },
      )}
      carregarPrecisaDeVoce={() => apiFetch<PrecisaDeVoce>(
        '/v1/agenda/precisa-de-voce',
        { clinicId, csrfToken },
      )}
      carregarResumoPaciente={async (patientId) => {
        const [paciente, pendencias] = await Promise.all([
          apiFetch<PacienteDaApi>(`/v1/pacientes/${patientId}`, { clinicId, csrfToken }),
          apiFetch<{ pendentes: string[] }>(`/v1/pacientes/${patientId}/pendencias`, { clinicId, csrfToken })
            .catch(() => ({ pendentes: [] as string[] })),
        ]);
        return { ...paciente, pendentes: pendencias.pendentes } satisfies PatientQuickSummary;
      }}
      aoCheckIn={(appointmentId) => apiFetch(
        `/v1/agenda/agendamentos/${appointmentId}/checkin`,
        { method: 'POST', clinicId, csrfToken },
      )}
      aoConfirmar={(appointmentId) => apiFetch(
        `/v1/agenda/agendamentos/${appointmentId}/status`,
        { method: 'POST', body: { status: 'confirmado' }, clinicId, csrfToken },
      )}
      aoAbrirAtendimento={(linha) => { void abrirAtendimento(linha); }}
      aoAbrirPaciente={(patientId) => router.push(`/pacientes/${patientId}`)}
      aoReagendar={(linha) => router.push(`/agenda?reagendar=${linha.appointmentId}`)}
      mensagensNaoLidasTotal={0}
      aoMensagem={(linha) => router.push(`/conversas?patientId=${linha.patientId}`)}
      aoCobrar={(linha) => router.push(`/financeiro/a-receber?patientId=${linha.patientId}`)}
      aoNovoAtendimento={() => router.push('/agenda?novo=1')}
      aoEnviarMensagem={() => router.push('/conversas?nova=1')}
    />
  );
}

export default function PaginaHoje() {
  return <Suspense><HojeInner /></Suspense>;
}
