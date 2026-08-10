'use client';

import { Suspense, useEffect, useState } from 'react';
import { useQueryState } from 'nuqs';
import { PageHeader } from '../../../src/ui/PageHeader';
import { apiFetch, ApiError } from '../../../src/api';
import { useSessao } from '../../../src/sessao';

interface EventoDaTrilha {
  eventId: string;
  ocorridoEm: string;
  eventType: string;
  entidade: string;
  entityId: string | null;
  outcome: 'sucesso' | 'negado' | 'erro';
  ator: string;
  atorKind: string;
  meta: Record<string, unknown> | null;
}

const CORES: Record<string, string> = {
  sucesso: 'text-text-muted',
  negado: 'text-warn',
  erro: 'text-danger',
};

/** Data local da clinica — a trilha e lida no fuso de quem responde por ela. */
function hojeNaClinica(timezone: string): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const v = (t: string): string => p.find((x) => x.type === t)?.value ?? '';
  return `${v('year')}-${v('month')}-${v('day')}`;
}

function AuditoriaInner() {
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();
  const tz = vinculoAtivo.timezone;

  const [de, setDe] = useQueryState('de', { defaultValue: hojeNaClinica(tz) });
  const [ate, setAte] = useQueryState('ate', { defaultValue: hojeNaClinica(tz) });
  const [tipo, setTipo] = useQueryState('tipo', { defaultValue: '' });
  const [outcome, setOutcome] = useQueryState('outcome', { defaultValue: '' });

  const [itens, setItens] = useState<EventoDaTrilha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const q = new URLSearchParams({ de, ate, limit: '200' });
    if (tipo !== '') q.set('tipo', tipo);
    if (outcome !== '') q.set('outcome', outcome);
    setItens(null);
    void apiFetch<{ itens: EventoDaTrilha[] }>(`/v1/auditoria?${q.toString()}`,
      { clinicId, csrfToken })
      .then((r) => { if (vivo) { setItens(r.itens); setErro(null); } })
      .catch((e: unknown) => {
        if (!vivo) return;
        // A API ja diz POR QUE recusou: `motivo: 'mfa_exigida'` em `dados`.
        // Jogar isso fora e mostrar "nao foi possivel" faz um administrador com
        // o papel certo achar que a tela quebrou — quando o que falta e um
        // passo que ele mesmo pode dar.
        const motivo = e instanceof ApiError ? e.dados['motivo'] : undefined;
        setErro(motivo === 'mfa_exigida'
          ? 'A trilha exige verificacao em duas etapas. Ative a sua em Configuracoes e entre de novo — a auditoria e o registro de quem viu o que, e ler isso sem segundo fator seria uma porta aberta.'
          : e instanceof ApiError && e.status === 403
            ? 'Seu perfil nao le a trilha de auditoria. So administracao e direcao tecnica leem.'
            : 'Nao foi possivel ler a trilha.');
      });
    return () => { vivo = false; };
  }, [de, ate, tipo, outcome, clinicId, csrfToken]);

  return (
    <div className="cadencia-page grid gap-5">
      <PageHeader
        titulo="Trilha de auditoria"
        subtitulo="Quem fez o que, quando e com que resultado. A trilha e append-only: nenhuma linha aqui pode ser alterada ou apagada, nem por quem administra."
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-text">De</span>
          <input type="date" value={de} onChange={(e) => { void setDe(e.target.value); }}
            className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text" />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-text">Ate</span>
          <input type="date" value={ate} onChange={(e) => { void setAte(e.target.value); }}
            className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text" />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-text">Tipo de evento</span>
          <input type="text" value={tipo} placeholder="PATIENT_SEARCH"
            onChange={(e) => { void setTipo(e.target.value.toUpperCase()); }}
            className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text" />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-text">Resultado</span>
          <select value={outcome} onChange={(e) => { void setOutcome(e.target.value); }}
            className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text">
            <option value="">Todos</option>
            <option value="sucesso">Sucesso</option>
            {/* `negado` e o que a auditoria procura primeiro: alguem tentou e
                o sistema recusou. Sucesso e ruido quando se investiga acesso. */}
            <option value="negado">Negado</option>
            <option value="erro">Erro</option>
          </select>
        </label>
      </div>

      {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}
      {itens === null && erro === null && (
        <p className="text-sm text-text-muted">Carregando…</p>
      )}

      {itens !== null && itens.length === 0 && (
        <p className="text-sm text-text-muted">
          Nenhum evento no periodo com esses filtros.
        </p>
      )}

      {itens !== null && itens.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-text-muted">
                <th className="pb-2">Quando</th>
                <th className="pb-2">Quem</th>
                <th className="pb-2">O que</th>
                <th className="pb-2">Onde</th>
                <th className="pb-2">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((e) => (
                <tr key={e.eventId} className="border-t border-line align-top">
                  <td className="py-2 whitespace-nowrap tabular-nums text-text-muted">
                    {/* Fuso da CLINICA, sempre: a trilha e lida por quem
                        responde por ela, que esta no horario da unidade. */}
                    {new Intl.DateTimeFormat('pt-BR', {
                      timeZone: tz, day: '2-digit', month: '2-digit',
                      hour: '2-digit', minute: '2-digit', second: '2-digit',
                    }).format(new Date(e.ocorridoEm))}
                  </td>
                  <td className="py-2">
                    <span className="block text-text">{e.ator}</span>
                    {e.atorKind !== 'user' && (
                      // `system` e `anon` importam: um job e o agendamento
                      // online agem sem pessoa por tras, e confundi-los com um
                      // usuario faria a auditoria acusar quem nao fez nada.
                      <span className="block text-xs text-text-muted">{e.atorKind}</span>
                    )}
                  </td>
                  <td className="py-2 font-mono text-xs text-text">{e.eventType}</td>
                  <td className="py-2 text-xs text-text-muted">
                    <span className="block">{e.entidade}</span>
                    {e.entityId !== null && (
                      <span className="block font-mono">{e.entityId.slice(0, 8)}</span>
                    )}
                  </td>
                  <td className={`py-2 ${CORES[e.outcome] ?? 'text-text'}`}>
                    {e.outcome}
                    {e.meta !== null && Object.keys(e.meta).length > 0 && (
                      <span className="block text-xs text-text-muted">
                        {Object.entries(e.meta)
                          .map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function PaginaAuditoria() {
  return <Suspense><AuditoriaInner /></Suspense>;
}
