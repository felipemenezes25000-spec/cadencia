'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../api';
import { useSessao } from '../sessao';

/**
 * A faixa de painel que fica abaixo da fila do dia: aniversariantes e os seis
 * graficos do inventario.
 *
 * Vive fora do componente `Hoje` de proposito. `Hoje` tem contrato proprio e
 * suite propria; enfiar mais responsabilidade nele obrigaria a mexer nos dois.
 * A composicao entre pedacos de tela e trabalho da pagina — a mesma regra que
 * o §2.2 aplica aos modulos.
 */

interface Aniversariante {
  patientId: string;
  nome: string;
  idade: number;
  telefone: string | null;
  temAgendamentoHoje: boolean;
}

interface Graficos {
  atendimentosNoPeriodo: { dia: string; total: number }[];
  porProcedimento: { rotulo: string; total: number }[];
  porConvenio: { rotulo: string; total: number }[];
  duracaoMedia: { rotulo: string; minutos: number }[];
  pacientesNovos: { dia: string; total: number }[];
  distribuicaoEtaria: { faixa: string; total: number }[];
}

/** Barra horizontal proporcional ao maior valor da serie. */
function Barras({ titulo, dados, sufixo }: {
  titulo: string;
  dados: readonly { rotulo: string; valor: number }[];
  sufixo?: string;
}) {
  const maior = Math.max(1, ...dados.map((d) => d.valor));
  return (
    <section className="rounded-[var(--r-md)] border border-line bg-surface p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
        {titulo}
      </h3>
      {dados.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">Sem dados no periodo.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {dados.slice(0, 7).map((d) => (
            <li key={d.rotulo} className="grid grid-cols-[1fr_auto] items-center gap-2">
              <div className="min-w-0">
                <span className="block truncate text-sm">{d.rotulo}</span>
                <div
                  className="mt-1 h-1.5 rounded-full bg-accent/70"
                  style={{ width: `${Math.round((d.valor / maior) * 100)}%` }}
                  // A barra e decorativa: o numero ao lado ja carrega o dado,
                  // e leitor de tela nao deve anunciar largura em porcentagem.
                  aria-hidden="true"
                />
              </div>
              <span className="font-mono text-sm tabular-nums">
                {d.valor}{sufixo ?? ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Série temporal como sparkline em barras. */
function Serie({ titulo, dados }: {
  titulo: string; dados: readonly { dia: string; total: number }[];
}) {
  const maior = Math.max(1, ...dados.map((d) => d.total));
  const total = dados.reduce((a, d) => a + d.total, 0);
  return (
    <section className="rounded-[var(--r-md)] border border-line bg-surface p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
        {titulo}
      </h3>
      <p className="mt-1 font-mono text-2xl tabular-nums">{total}</p>
      <div className="mt-3 flex h-12 items-end gap-0.5" role="img"
           aria-label={`${titulo}: ${total} no periodo`}>
        {dados.map((d) => (
          <div
            key={d.dia}
            title={`${d.dia.split('-').reverse().join('/')}: ${d.total}`}
            className="min-w-[3px] flex-1 rounded-t-sm bg-accent/60"
            style={{ height: `${Math.max(4, Math.round((d.total / maior) * 100))}%` }}
          />
        ))}
      </div>
    </section>
  );
}

export function PainelDoDia() {
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();
  const [aniversariantes, setAniversariantes] = useState<readonly Aniversariante[]>([]);
  const [graficos, setGraficos] = useState<Graficos | null>(null);

  // Gráficos são informação de gestão; a recepção não tem `report.read`. Pedir
  // e receber 403 poluiria o console — não pedimos.
  const podeVerGraficos = vinculoAtivo.role !== 'recepcao';

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const a = await apiFetch<{ itens: Aniversariante[] }>(
        '/v1/painel/aniversariantes', { clinicId, csrfToken })
        .catch(() => ({ itens: [] as Aniversariante[] }));
      if (vivo) setAniversariantes(a.itens);

      if (!podeVerGraficos) return;
      const g = await apiFetch<Graficos>(
        '/v1/painel/graficos?dias=30', { clinicId, csrfToken })
        .catch((e: unknown) => {
          if (e instanceof ApiError) return null;
          throw e;
        });
      if (vivo && g !== null) setGraficos(g);
    })();
    return () => { vivo = false; };
  }, [clinicId, csrfToken, podeVerGraficos]);

  return (
    <div className="grid gap-4 px-[var(--s-6)] pb-[var(--s-8)]">
      {aniversariantes.length > 0 && (
        <section className="rounded-[var(--r-md)] border border-line bg-surface p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Aniversariantes de hoje
          </h3>
          <ul className="mt-3 flex flex-wrap gap-2">
            {aniversariantes.map((p) => (
              <li key={p.patientId}
                  className="flex items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-sm">
                <span className="font-medium">{p.nome}</span>
                <span className="text-text-muted">{p.idade} anos</span>
                {p.temAgendamentoHoje && (
                  // Quem ja vem hoje e cumprimentado pessoalmente: a marca evita
                  // a clinica mandar parabens automatico para quem esta na sala.
                  <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">
                    vem hoje
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {graficos !== null && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Serie titulo="Atendimentos no periodo" dados={graficos.atendimentosNoPeriodo} />
          <Serie titulo="Pacientes novos" dados={graficos.pacientesNovos} />
          <Barras titulo="Por procedimento"
                  dados={graficos.porProcedimento.map((x) => ({
                    rotulo: x.rotulo, valor: x.total }))} />
          <Barras titulo="Por convenio"
                  dados={graficos.porConvenio.map((x) => ({
                    rotulo: x.rotulo, valor: x.total }))} />
          <Barras titulo="Duracao media realizada" sufixo=" min"
                  dados={graficos.duracaoMedia.map((x) => ({
                    rotulo: x.rotulo, valor: x.minutos }))} />
          <Barras titulo="Distribuicao etaria"
                  dados={graficos.distribuicaoEtaria.map((x) => ({
                    rotulo: x.faixa, valor: x.total }))} />
        </div>
      )}
    </div>
  );
}
