'use client';

import { Suspense, useEffect, useState } from 'react';
import { useQueryState } from 'nuqs';
import type { LinhaDaFila } from '../../../src/telas/Hoje';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';

/**
 * A agenda do dia em papel.
 *
 * Existe porque a clínica imprime. Recepção com a folha no balcão, médico com a
 * lista no bolso entre uma sala e outra, e o dia em que a internet cai — que é
 * justamente o dia em que a agenda impressa salva o expediente.
 *
 * O que sai no papel é deliberadamente MENOS do que a tela: horário, paciente,
 * profissional e procedimento. Convênio, telefone e observação ficam de fora —
 * papel de agenda circula pela clínica, fica em cima de mesa e vai para o lixo
 * comum. Cada campo a mais é um dado de paciente exposto sem controle.
 */

function horaLocal(iso: string, fuso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

const ROTULO_STATUS: Record<string, string> = {
  agendado: 'Agendado', confirmado: 'Confirmado', aguardando: 'Aguardando',
  atendendo: 'Em atendimento', atendido: 'Atendido', faltou: 'Faltou',
  cancelado: 'Cancelado',
};

function ImprimirInner() {
  const { clinicId, csrfToken } = useSessao();
  const [dia] = useQueryState('dia', {
    defaultValue: new Date().toISOString().slice(0, 10),
  });
  const [fila, setFila] = useState<readonly LinhaDaFila[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const FUSO = 'America/Sao_Paulo';

  useEffect(() => {
    let vivo = true;
    void apiFetch<{ fila: LinhaDaFila[] }>(
      `/v1/agenda/dia?dia=${dia}`, { clinicId, csrfToken })
      .then((r) => {
        if (!vivo) return;
        // Cancelado não entra no papel: quem lê a folha quer saber quem VEM.
        setFila(r.fila.filter((l) => l.status !== 'cancelado'));
        setCarregando(false);
      })
      .catch(() => { if (vivo) { setErro('Não foi possível carregar a agenda.'); setCarregando(false); } });
    return () => { vivo = false; };
  }, [dia, clinicId, csrfToken]);

  const dataExtenso = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  }).format(new Date(`${dia}T12:00:00Z`));

  return (
    <div className="mx-auto max-w-3xl p-8 print:p-0">
      <div className="print:hidden mb-6 flex items-center justify-between">
        <p className="text-sm text-text-muted">
          Confira e use <kbd className="rounded border border-line px-1.5">Ctrl+P</kbd> para imprimir.
        </p>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-[var(--r-sm)] bg-accent px-4 py-2 text-sm font-medium text-accent-on"
        >
          Imprimir
        </button>
      </div>

      <header className="mb-4 border-b border-line pb-3">
        <h1 className="text-lg font-semibold text-text">Agenda do dia</h1>
        <p className="text-sm text-text-muted">
          {dataExtenso} · {fila.length} {fila.length === 1 ? 'atendimento' : 'atendimentos'}
        </p>
      </header>

      {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}
      {carregando && <p className="text-sm text-text-muted">Carregando…</p>}

      {!carregando && fila.length === 0 && (
        <p className="text-sm text-text-muted">Nenhum atendimento neste dia.</p>
      )}

      {fila.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-text-muted">
              <th className="py-2 pr-3">Hora</th>
              <th className="py-2 pr-3">Paciente</th>
              <th className="py-2 pr-3">Profissional</th>
              <th className="py-2 pr-3">Procedimento</th>
              <th className="py-2">Situação</th>
            </tr>
          </thead>
          <tbody>
            {fila.map((l) => (
              <tr
                key={l.appointmentId}
                // `break-inside-avoid`: uma linha partida entre duas folhas faz
                // o horário ficar numa página e o nome na outra.
                className="break-inside-avoid border-b border-line last:border-b-0"
              >
                <td className="py-2 pr-3 font-mono tabular-nums">
                  {horaLocal(l.startsAt, FUSO)}
                </td>
                <td className="py-2 pr-3">{l.displayName}</td>
                <td className="py-2 pr-3">{l.professionalNome ?? '—'}</td>
                <td className="py-2 pr-3">{l.procedureNome ?? '—'}</td>
                <td className="py-2">{ROTULO_STATUS[l.status] ?? l.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className="mt-6 border-t border-line pt-3 text-xs text-text-muted">
        {/* Sem carimbo de hora da impressão: a folha circula e vai para o lixo
            comum, então ela carrega o mínimo. A data do dia já está no topo. */}
        Documento interno. Contém dado de paciente — descarte com cuidado.
      </footer>
    </div>
  );
}

export default function PaginaImprimirAgenda() {
  return (
    <Suspense>
      <ImprimirInner />
    </Suspense>
  );
}
