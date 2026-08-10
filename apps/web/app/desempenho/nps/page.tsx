'use client';

import { useEffect, useState } from 'react';
import { useQueryState, parseAsInteger } from 'nuqs';
import { Suspense } from 'react';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';

interface Nps {
  nps: number;
  respostas: number;
  promotores: number;
  neutros: number;
  detratores: number;
  comentarios: { score: number; comentario: string; em: string }[];
}

function faixa(score: number): { rotulo: string; cor: string } {
  if (score >= 9) return { rotulo: 'Promotor', cor: 'text-ok' };
  if (score >= 7) return { rotulo: 'Neutro', cor: 'text-text-muted' };
  return { rotulo: 'Detrator', cor: 'text-danger' };
}

function NpsInner() {
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();
  const [dias, setDias] = useQueryState('dias', parseAsInteger.withDefault(90));
  const [d, setD] = useState<Nps | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void apiFetch<Nps>(`/v1/nps?dias=${dias}`, { clinicId, csrfToken })
      .then((r) => { if (vivo) setD(r); })
      .catch(() => { if (vivo) setErro('Nao foi possivel carregar o NPS.'); });
    return () => { vivo = false; };
  }, [dias, clinicId, csrfToken]);

  return (
    <div className="grid gap-6">
      <div className="flex gap-2">
        {[30, 90, 180, 365].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => { void setDias(n); }}
            className={dias === n
              ? 'rounded-[var(--r-sm)] bg-accent px-3 py-1.5 text-sm text-accent-on'
              : 'rounded-[var(--r-sm)] border border-line px-3 py-1.5 text-sm text-text hover:bg-surface-hover'}
          >
            {n} dias
          </button>
        ))}
      </div>

      {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}
      {d === null && erro === null && (
        <p className="text-sm text-text-muted">Carregando…</p>
      )}

      {d !== null && (
        <>
          <section className="grid gap-4 sm:grid-cols-4">
            <div className="rounded-[var(--r-md)] border border-line bg-surface p-4">
              <p className="text-xs uppercase tracking-wide text-text-muted">NPS</p>
              <p className="text-3xl font-semibold tabular-nums text-text">{d.nps}</p>
              {/* `respostas` fica JUNTO do indice de proposito: NPS zero com 200
                  respostas e empate real; com zero respostas e ausencia de dado.
                  O mesmo numero, significados incompativeis. */}
              <p className="text-xs text-text-muted">
                {d.respostas === 0
                  ? 'nenhuma resposta ainda'
                  : `${d.respostas} ${d.respostas === 1 ? 'resposta' : 'respostas'}`}
              </p>
            </div>
            {([
              ['Promotores', d.promotores, 'text-ok'],
              ['Neutros', d.neutros, 'text-text-muted'],
              ['Detratores', d.detratores, 'text-danger'],
            ] as const).map(([rotulo, valor, cor]) => (
              <div key={rotulo} className="rounded-[var(--r-md)] border border-line bg-surface p-4">
                <p className="text-xs uppercase tracking-wide text-text-muted">{rotulo}</p>
                <p className={`text-3xl font-semibold tabular-nums ${cor}`}>{valor}</p>
                <p className="text-xs text-text-muted">
                  {d.respostas === 0 ? '—'
                    : `${Math.round((valor / d.respostas) * 100)}%`}
                </p>
              </div>
            ))}
          </section>

          <section className="grid gap-2">
            <h2 className="text-sm font-semibold text-text">O que escreveram</h2>
            {d.comentarios.length === 0 ? (
              <p className="text-sm text-text-muted">
                Nenhum comentario no periodo. A nota diz que ha algo errado; o
                comentario diz o que consertar.
              </p>
            ) : (
              <ul className="grid gap-2">
                {d.comentarios.map((c, i) => {
                  const f = faixa(c.score);
                  return (
                    <li key={`${c.em}-${i}`}
                      className="rounded-[var(--r-sm)] border border-line bg-surface p-3">
                      <p className="mb-1 flex items-center gap-2 text-xs">
                        <span className={`font-semibold ${f.cor}`}>{c.score}</span>
                        <span className="text-text-muted">{f.rotulo}</span>
                        <span className="text-text-muted">
                          {/* Com fuso EXPLICITO da unidade: `received_at` chega
                              como instante em UTC, e formatar sem `timeZone`
                              usaria o relogio de quem esta olhando — que pode
                              nao ser o da clinica. */}
                          · {new Intl.DateTimeFormat('pt-BR', {
                            timeZone: vinculoAtivo.timezone,
                            day: '2-digit', month: '2-digit',
                          }).format(new Date(c.em))}
                        </span>
                      </p>
                      <p className="text-sm text-text">{c.comentario}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default function PaginaNps() {
  return (
    <Suspense>
      <NpsInner />
    </Suspense>
  );
}
