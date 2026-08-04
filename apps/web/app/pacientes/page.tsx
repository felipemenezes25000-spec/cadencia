'use client';

import { useQueryState, parseAsStringLiteral } from 'nuqs';
import { Pacientes } from '../../src/telas/Pacientes';
import { apiFetch } from '../../src/api';
import { useSessao } from '../../src/sessao';
import type { PacienteHit } from '../../src/ui/ComboboxDePaciente';

const CHAVES_FACETA = ['ativos', 'inativos', 'obitos', 'cadastro_preliminar', 'sem_retorno'] as const;

export default function PaginaPacientes() {
  const { clinicId, csrfToken } = useSessao();
  const [faceta, setFaceta] = useQueryState('faceta',
    parseAsStringLiteral(CHAVES_FACETA).withDefault('ativos'));

  return (
    <Pacientes
      faceta={faceta}
      aoMudarFaceta={(f) => { void setFaceta(f as typeof CHAVES_FACETA[number]); }}
      buscar={(termo, f) => apiFetch<PacienteHit[]>(
        `/v1/pacientes?faceta=${f}&termo=${encodeURIComponent(termo)}`,
        { clinicId, csrfToken })}
      aoAbrir={(id) => { window.location.href = `/pacientes/${id}`; }}
    />
  );
}
