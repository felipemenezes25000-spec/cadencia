'use client';

import { useEffect, useState } from 'react';
import { VISOES, faixasDoDia, posicaoNaGrade, type Visao } from './grade';
import type { LinhaDaFila } from './Hoje';

export interface AgendaProps {
  readonly dia: string;
  readonly visao: Visao['chave'];
  readonly timezone: string;
  readonly carregar: (dia: string) => Promise<LinhaDaFila[]>;
  readonly aoMudarVisao: (v: Visao['chave']) => void;
  readonly aoMudarDia: (dia: string) => void;
  readonly aoAbrirCompositor: (inicioMin: number) => void;
  readonly aoMover: (appointmentId: string, novoInicioIso: string) => Promise<void>;
}

const INICIO_MIN = 7 * 60;
const FIM_MIN = 21 * 60;
const PASSO_MIN = 15;

export function Agenda(p: AgendaProps) {
  const [itens, setItens] = useState<LinhaDaFila[]>([]);
  const faixas = faixasDoDia({ inicioMin: INICIO_MIN, fimMin: FIM_MIN, passoMin: PASSO_MIN });

  useEffect(() => { void p.carregar(p.dia).then(setItens); }, [p, p.dia]);

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent): void {
      const alvo = e.target as HTMLElement | null;
      const editando = alvo?.tagName === 'INPUT' || alvo?.tagName === 'TEXTAREA'
        || alvo?.isContentEditable === true;
      if (editando || e.metaKey || e.ctrlKey || e.altKey) return;
      const v = VISOES.find((x) => x.atalho === e.key);
      if (v !== undefined) { e.preventDefault(); p.aoMudarVisao(v.chave); }
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [p]);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)' }}>
      <div role="tablist" aria-label="Visões da agenda"
           style={{ display: 'flex', gap: 'var(--s-1)' }}>
        {VISOES.map((v) => (
          <button
            key={v.chave} role="tab" type="button"
            aria-selected={p.visao === v.chave}
            onClick={() => p.aoMudarVisao(v.chave)}
            style={{
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              background: p.visao === v.chave ? 'var(--accent-soft)' : 'var(--surface)',
              color: 'var(--text)', minHeight: 32, padding: `0 var(--s-5)`,
              fontSize: 'var(--fs-13)', cursor: 'pointer',
            }}
          >
            {v.rotulo}
          </button>
        ))}
      </div>

      <div
        aria-label={`Agenda de ${p.dia}`}
        style={{
          display: 'grid',
          gridTemplateColumns: '64px 1fr',
          gridTemplateRows: `repeat(${faixas.length}, 18px)`,
          border: 'var(--border)', borderRadius: 'var(--r-md)',
          background: 'var(--surface)', position: 'relative',
        }}
      >
        {faixas.map((f, i) => (
          <span key={f} aria-hidden="true"
            style={{ gridColumn: 1, gridRow: i + 1, fontSize: 'var(--fs-11)',
                     color: 'var(--text-faint)', paddingInlineEnd: 'var(--s-3)',
                     textAlign: 'right', borderBottom: i % 4 === 3 ? 'var(--border)' : 'none' }}>
            {i % 4 === 0 ? f : ''}
          </span>
        ))}
        {faixas.map((f, i) => (
          <div key={`c-${f}`} data-slot="vazio"
            onClick={() => p.aoAbrirCompositor(INICIO_MIN + i * PASSO_MIN)}
            style={{ gridColumn: 2, gridRow: i + 1, cursor: 'pointer',
                     borderBottom: i % 4 === 3 ? 'var(--border)' : 'none' }} />
        ))}
        {itens.map((it) => {
          const pos = posicaoNaGrade(it.startsAt, it.endsAt,
            { inicioMin: INICIO_MIN, passoMin: PASSO_MIN, timezone: p.timezone });
          return (
            <button
              key={it.appointmentId} type="button"
              style={{
                gridColumn: 2, gridRow: `${pos.linhaInicio} / ${pos.linhaFim}`,
                textAlign: 'left', border: 'var(--border)',
                borderInlineStart: `3px solid ${it.procedureCor ?? 'var(--st-agendado)'}`,
                borderRadius: 'var(--r-sm)',
                background: it.encaixe
                  ? 'repeating-linear-gradient(45deg, var(--surface) 0 6px, var(--surface-sunken) 6px 12px)'
                  : 'var(--surface)',
                margin: 1, padding: `var(--s-2) var(--s-4)`, cursor: 'grab',
                fontSize: 'var(--fs-13)', overflow: 'hidden',
              }}
            >
              {it.displayName}
            </button>
          );
        })}
      </div>
    </div>
  );
}
