'use client';

import { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryState, parseAsStringLiteral } from 'nuqs';
import { Pacientes } from '../../src/telas/Pacientes';
import { apiFetch } from '../../src/api';
import { useSessao } from '../../src/sessao';
import type { PacienteHit } from '../../src/ui/ComboboxDePaciente';

const CHAVES_FACETA = ['ativos', 'inativos', 'obitos', 'cadastro_preliminar', 'sem_retorno'] as const;

function PacientesInner() {
  const { clinicId, csrfToken } = useSessao();
  const router = useRouter();
  const [faceta, setFaceta] = useQueryState('faceta',
    parseAsStringLiteral(CHAVES_FACETA).withDefault('ativos'));

  return (
    <Pacientes
      faceta={faceta}
      aoMudarFaceta={(f) => { void setFaceta(f as typeof CHAVES_FACETA[number]); }}
      // /v1/pacientes/lista, e não /v1/pacientes: a busca do combobox devolve
      // vazio sem termo, e a tela de lista precisa abrir já povoada.
      buscar={(termo, f) => apiFetch<{ itens: PacienteHit[] }>(
        `/v1/pacientes/lista?faceta=${f}&termo=${encodeURIComponent(termo)}`,
        { clinicId, csrfToken }).then((r) => r.itens)}
      aoAbrir={(id) => { router.push(`/pacientes/${id}`); }}
    />
  );
}

export default function PaginaPacientes() {
  return (
    <Suspense>
      <PacientesInner />
    </Suspense>
  );
}
