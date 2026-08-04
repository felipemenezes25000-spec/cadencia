'use client';

import { useQueryState, parseAsStringLiteral } from 'nuqs';
import { Hoje, type LinhaDaFila, type PrecisaDeVoce } from '../../src/telas/Hoje';
import type { Contadores, FiltroDoDia } from '../../src/ui/FaixaDeContadores';
import { apiFetch } from '../../src/api';
import { useSessao } from '../../src/sessao';

const FILTROS = ['agendados', 'confirmados', 'aguardando', 'atendidos', 'faltas'] as const;

export default function PaginaHoje() {
  const { clinicId, csrfToken } = useSessao();
  const [filtro, setFiltro] = useQueryState('faceta', parseAsStringLiteral(FILTROS));
  const dia = new Date().toISOString().slice(0, 10);

  return (
    <Hoje
      dia={dia}
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
      aoAbrirAtendimento={(l) => { window.location.href = `/atendimento/novo?paciente=${l.patientId}`; }}
    />
  );
}

function mapa(f: FiltroDoDia): string {
  return f === 'agendados' ? '' : f === 'faltas' ? 'faltou'
    : f === 'confirmados' ? 'confirmado' : f === 'atendidos' ? 'atendido' : 'aguardando';
}
