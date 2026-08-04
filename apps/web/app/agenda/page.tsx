'use client';

import { useQueryState, parseAsStringLiteral } from 'nuqs';
import { Agenda } from '../../src/telas/Agenda';
import type { LinhaDaFila } from '../../src/telas/Hoje';
import type { Visao } from '../../src/telas/grade';
import { apiFetch } from '../../src/api';
import { useSessao } from '../../src/sessao';

const CHAVES_VISAO = ['dia', 'semana', 'mes', 'profissional', 'sala'] as const;

export default function PaginaAgenda() {
  const { clinicId, csrfToken } = useSessao();
  const [visao, setVisao] = useQueryState('visao',
    parseAsStringLiteral(CHAVES_VISAO).withDefault('dia'));
  const [dia, setDia] = useQueryState('dia', { defaultValue: new Date().toISOString().slice(0, 10) });

  return (
    <Agenda
      dia={dia}
      visao={visao as Visao['chave']}
      timezone="America/Sao_Paulo"
      aoMudarVisao={(v) => { void setVisao(v); }}
      aoMudarDia={(d) => { void setDia(d); }}
      carregar={(d) => apiFetch<LinhaDaFila[]>(
        `/v1/agenda/dia?dia=${d}`, { clinicId, csrfToken })}
      aoAbrirCompositor={() => {}}
      aoMover={async () => {}}
    />
  );
}
