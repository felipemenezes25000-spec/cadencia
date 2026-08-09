// apps/web/src/telas/FinanceiroRepasse.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { CaretLeft, CaretRight, CurrencyDollar } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Botao } from '../ui/Botao';
import { Icone } from '../ui/Icone';
import { Skeleton } from '../ui/Skeleton';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface RepasseProfissional {
  readonly id: string;
  readonly nome: string;
  readonly totalBruto: number;
  readonly percentual: number;
  readonly totalRepasse: number;
  readonly status: 'pendente' | 'pago';
  readonly atendimentos: number;
  readonly especialidade?: string;
}

export interface RepasseDados {
  readonly profissionais: readonly RepasseProfissional[];
  readonly totalRepasse: number;
  readonly periodo: { readonly inicio: string; readonly fim: string };
}

export interface FiltrosRepasse {
  readonly profissionalId?: string;
  readonly status?: string;
  readonly dataInicio?: string;
  readonly dataFim?: string;
}

export type PapelRepasse = 'admin_clinico' | 'diretor_tecnico' | 'financeiro' | 'profissional';

export interface FinanceiroRepasseProps {
  readonly carregarDados: (filtros: FiltrosRepasse) => Promise<RepasseDados>;
  readonly papelAtual: PapelRepasse;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

const MESES = [
  'Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
] as const;

function formatarMesAno(mes: number, ano: number): string {
  return `${MESES[mes]} ${ano}`;
}

function iniciais(nome: string): string {
  return nome
    .split(' ')
    .filter((p) => p.length > 0)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
}

function periodoParaMesAno(inicio: string): { mes: number; ano: number } {
  const [ano, mesStr] = inicio.split('-');
  return { mes: Number(mesStr) - 1, ano: Number(ano) };
}

// ── Skeleton de carregamento ──────────────────────────────────────────────

function RepasseSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Carregando repasse...">
      {/* Seletor de periodo skeleton */}
      <div className="flex items-center justify-center gap-2">
        <Skeleton variant="text" width="28px" height="28px" />
        <Skeleton variant="text" width="140px" height="20px" />
        <Skeleton variant="text" width="28px" height="28px" />
      </div>
      {/* Cards skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} variant="card" height="120px" />
        ))}
      </div>
      {/* Tabela skeleton */}
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-elev-1">
        <div className="border-b border-line bg-surface-raised px-4 py-2.5">
          <Skeleton variant="text" width="80%" height="16px" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="border-b border-line px-4 py-3">
            <Skeleton variant="table-row" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Estado vazio ──────────────────────────────────────────────────────────

function EstadoVazio() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Icone icon={CurrencyDollar} size="xl" className="text-text-muted mb-3" />
      <p className="text-base font-medium text-text">
        Nenhum repasse encontrado
      </p>
      <p className="mt-1 text-sm text-text-muted">
        Nao ha dados de repasse para o periodo selecionado
      </p>
    </div>
  );
}

// ── Componente ─────────────────────────────────────────────────────────────

export function FinanceiroRepasse(p: FinanceiroRepasseProps) {
  const [dados, setDados] = useState<RepasseDados | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [mes, setMes] = useState(() => new Date().getMonth());
  const [ano, setAno] = useState(() => new Date().getFullYear());

  useEffect(() => {
    setCarregando(true);
    void p.carregarDados({}).then((d) => {
      setDados(d);
      // Sincronizar periodo com os dados retornados
      if (d.periodo?.inicio) {
        const periodoInfo = periodoParaMesAno(d.periodo.inicio);
        setMes(periodoInfo.mes);
        setAno(periodoInfo.ano);
      }
      setCarregando(false);
    });
  }, [p]);

  function mesPrevio(): void {
    let novoMes = mes - 1;
    let novoAno = ano;
    if (novoMes < 0) {
      novoMes = 11;
      novoAno = ano - 1;
    }
    setMes(novoMes);
    setAno(novoAno);

    const inicio = `${novoAno}-${String(novoMes + 1).padStart(2, '0')}-01`;
    const ultimoDia = new Date(novoAno, novoMes + 1, 0).getDate();
    const fim = `${novoAno}-${String(novoMes + 1).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;

    setCarregando(true);
    void p.carregarDados({ dataInicio: inicio, dataFim: fim }).then((d) => {
      setDados(d);
      setCarregando(false);
    });
  }

  function mesProximo(): void {
    let novoMes = mes + 1;
    let novoAno = ano;
    if (novoMes > 11) {
      novoMes = 0;
      novoAno = ano + 1;
    }
    setMes(novoMes);
    setAno(novoAno);

    const inicio = `${novoAno}-${String(novoMes + 1).padStart(2, '0')}-01`;
    const ultimoDia = new Date(novoAno, novoMes + 1, 0).getDate();
    const fim = `${novoAno}-${String(novoMes + 1).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;

    setCarregando(true);
    void p.carregarDados({ dataInicio: inicio, dataFim: fim }).then((d) => {
      setDados(d);
      setCarregando(false);
    });
  }

  // Total geral de repasse
  const totalGeral = useMemo(() => {
    if (!dados) return 0;
    return dados.totalRepasse;
  }, [dados]);

  if (carregando) {
    return <RepasseSkeleton />;
  }

  if (!dados || dados.profissionais.length === 0) {
    return (
      <div className="space-y-6">
        {/* Seletor de periodo */}
        <div className="flex items-center justify-center gap-2" aria-label="Seletor de periodo">
          <Botao variante="fantasma" tamanho="sm" iconeEsquerda={CaretLeft} onClick={mesPrevio} aria-label="Mes anterior">
            {'​'}
          </Botao>
          <span className="min-w-[140px] text-center text-sm font-medium text-text">
            {formatarMesAno(mes, ano)}
          </span>
          <Botao variante="fantasma" tamanho="sm" iconeEsquerda={CaretRight} onClick={mesProximo} aria-label="Proximo mes">
            {'​'}
          </Botao>
        </div>
        <EstadoVazio />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Seletor de periodo */}
      <div className="flex items-center justify-center gap-2" aria-label="Seletor de periodo">
        <Botao variante="fantasma" tamanho="sm" iconeEsquerda={CaretLeft} onClick={mesPrevio} aria-label="Mes anterior">
          {'​'}
        </Botao>
        <span className="min-w-[140px] text-center text-sm font-medium text-text">
          {formatarMesAno(mes, ano)}
        </span>
        <Botao variante="fantasma" tamanho="sm" iconeEsquerda={CaretRight} onClick={mesProximo} aria-label="Proximo mes">
          {'​'}
        </Botao>
      </div>

      {/* Total geral */}
      <div className="flex items-baseline justify-between">
        <h2 className="text-[length:var(--fs-15)] font-semibold text-text">
          Repasse
        </h2>
        <span className="tabular-nums text-[length:var(--fs-18)] font-semibold text-text">
          {centavosParaReais(totalGeral)}
        </span>
      </div>

      {/* Cards de resumo por profissional */}
      <section aria-label="Resumo por profissional">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {dados.profissionais.map((pr) => (
            <div
              key={pr.id}
              className="rounded-xl border border-line bg-surface shadow-elev-1 p-4"
            >
              <div className="mb-3 flex items-center gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent"
                >
                  {iniciais(pr.nome)}
                </div>
                <div>
                  <p className="text-sm font-medium text-text">{pr.nome}</p>
                  {pr.especialidade && (
                    <p className="text-xs text-text-muted">{pr.especialidade}</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-text-muted">Producao</span>
                  <p className="font-semibold tabular-nums text-text">
                    {centavosParaReais(pr.totalBruto)}
                  </p>
                </div>
                <div>
                  <span className="text-text-muted">Repasse ({pr.percentual}%)</span>
                  <p className="font-semibold tabular-nums text-ok">
                    {centavosParaReais(pr.totalRepasse)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Tabela detalhada */}
      <section aria-label="Repasse por profissional">
        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-elev-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-raised">
                <th className="px-4 py-2.5 text-left font-medium text-text-muted">
                  Profissional
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-text-muted">
                  Atendimentos
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-text-muted">
                  Producao
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-text-muted">
                  %
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-text-muted">
                  Repasse
                </th>
                <th className="px-4 py-2.5 text-center font-medium text-text-muted">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {dados.profissionais.map((pr) => (
                <tr
                  key={pr.id}
                  className="transition-colors duration-[var(--dur-2)] hover:bg-surface-raised"
                >
                  <td className="px-4 py-3 font-medium text-text">{pr.nome}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-text">
                    {pr.atendimentos}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text">
                    {centavosParaReais(pr.totalBruto)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text">
                    {pr.percentual}%
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-ok">
                    {centavosParaReais(pr.totalRepasse)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
                        pr.status === 'pago'
                          ? 'bg-ok-soft text-ok'
                          : 'bg-warn-soft text-warn',
                      )}
                    >
                      <span aria-hidden="true">{pr.status === 'pago' ? '✓' : '⏱'}</span>
                      {pr.status === 'pago' ? 'Pago' : 'Pendente'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-surface-raised">
                <td className="px-4 py-2.5 font-semibold text-text" colSpan={4}>
                  Total
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-text">
                  {centavosParaReais(totalGeral)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}
