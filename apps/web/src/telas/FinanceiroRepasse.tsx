// apps/web/src/telas/FinanceiroRepasse.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface RepasseProfissional {
  readonly id: string;
  readonly nome: string;
  readonly totalBruto: number;
  readonly percentual: number;
  readonly totalRepasse: number;
  readonly status: 'pendente' | 'pago';
  readonly atendimentos: number;
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

const PAPEIS_GESTAO: readonly string[] = ['admin_clinico', 'diretor_tecnico', 'financeiro'];

// ── Componente ─────────────────────────────────────────────────────────────

export function FinanceiroRepasse(p: FinanceiroRepasseProps) {
  const [dados, setDados] = useState<RepasseDados | null>(null);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [profissionalId, setProfissionalId] = useState('');

  const ehGestao = PAPEIS_GESTAO.includes(p.papelAtual);

  useEffect(() => {
    void p.carregarDados({}).then(setDados);
  }, [p]);

  function filtrar(): void {
    void p.carregarDados({
      profissionalId: profissionalId === '' ? undefined : profissionalId,
      dataInicio: dataInicio === '' ? undefined : dataInicio,
      dataFim: dataFim === '' ? undefined : dataFim,
    }).then(setDados);
  }

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      {/* Filtros */}
      <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap', alignItems: 'end' }}>
        {ehGestao ? (
          <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
            <label htmlFor="filtro-profissional-rep" style={{
              fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
              lineHeight: 1.3, color: 'var(--text-muted)',
            }}>
              Profissional
            </label>
            <select
              id="filtro-profissional-rep"
              value={profissionalId}
              onChange={(e) => setProfissionalId(e.target.value)}
              aria-label="Profissional"
              style={{
                height: 32, padding: '0 var(--s-4)',
                border: 'var(--border)', borderRadius: 'var(--r-md)',
                background: 'var(--surface)', color: 'var(--text)',
                fontSize: 'var(--fs-14)',
              }}
            >
              <option value="">Todos</option>
              {dados.profissionais.map((pr) => (
                <option key={pr.id} value={pr.id}>{pr.nome}</option>
              ))}
            </select>
          </div>
        ) : null}
        <Campo rotulo="Periodo inicio" type="date" denso
          value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
          aria-label="Periodo inicio" />
        <Campo rotulo="Periodo fim" type="date" denso
          value={dataFim} onChange={(e) => setDataFim(e.target.value)}
          aria-label="Periodo fim" />
        <Botao variante="secundario" altura={32} onClick={filtrar}>
          Filtrar
        </Botao>
      </div>

      {/* Total */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          Repasse
        </h2>
        <span className="num" style={{ fontSize: 'var(--fs-18)',
                                        fontWeight: 'var(--fw-semibold)',
                                        fontVariantNumeric: 'tabular-nums' }}>
          {centavosParaReais(dados.totalRepasse)}
        </span>
      </div>

      {/* Lista por profissional */}
      <section aria-label="Repasse por profissional">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.profissionais.map((pr) => (
            <li key={pr.id} style={{
              display: 'grid', gridTemplateColumns: '1fr auto',
              alignItems: 'center', gap: 'var(--s-4)',
              padding: 'var(--s-5) var(--s-5)',
              borderBottom: 'var(--border)', minHeight: 56,
            }}>
              <div>
                <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-15)' }}>
                  {pr.nome}
                </span>
                <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                               color: 'var(--text-muted)' }}>
                  {pr.atendimentos} atendimentos — Bruto {centavosParaReais(pr.totalBruto)} — <span>{pr.percentual}%</span>
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
                <span className="num" style={{
                  fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {centavosParaReais(pr.totalRepasse)}
                </span>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)',
                  fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
                  fontWeight: 'var(--fw-medium)', padding: 'var(--s-1) var(--s-4)',
                  borderRadius: 'var(--r-full)',
                  color: pr.status === 'pago' ? 'var(--ok)' : 'var(--warn)',
                  background: 'var(--surface-sunken)',
                }}>
                  <span aria-hidden="true">{pr.status === 'pago' ? '✓' : '⏱'}</span>
                  {pr.status === 'pago' ? 'Pago' : 'Pendente'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
