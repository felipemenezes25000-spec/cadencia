// apps/web/src/telas/FormRecursoGlosa.tsx
'use client';

import { useState } from 'react';
import { Botao } from '../ui/Botao';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface GlosaParaRecurso {
  readonly id: string;
  readonly guiaNumero: string;
  readonly pacienteNome: string;
  readonly codigoGlosa: string;
  readonly descricaoGlosa: string;
  readonly valorGlosadoCentavos: number;
}

export interface DadosRecurso {
  readonly glosas: { glosaId: string; justificativa: string }[];
  readonly justificativaGeral: string;
}

export interface FormRecursoGlosaProps {
  readonly glosas: readonly GlosaParaRecurso[];
  readonly aoSubmeter: (dados: DadosRecurso) => Promise<void>;
  readonly aoCancelar: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

// ── Componente ─────────────────────────────────────────────────────────────

export function FormRecursoGlosa(p: FormRecursoGlosaProps) {
  const [passo, setPasso] = useState<1 | 2>(1);
  const [justificativas, setJustificativas] = useState<Record<string, string>>(
    () => Object.fromEntries(p.glosas.map((g) => [g.id, ''])),
  );
  const [justificativaGeral, setJustificativaGeral] = useState('');
  const [submetendo, setSubmetendo] = useState(false);

  const todasPreenchidas = p.glosas.every(
    (g) => (justificativas[g.id] ?? '').trim().length > 0,
  );

  const totalCentavos = p.glosas.reduce((s, g) => s + g.valorGlosadoCentavos, 0);

  function atualizarJustificativa(glosaId: string, valor: string): void {
    setJustificativas((prev) => ({ ...prev, [glosaId]: valor }));
  }

  function submeter(): void {
    setSubmetendo(true);
    void p.aoSubmeter({
      glosas: p.glosas.map((g) => ({
        glosaId: g.id,
        justificativa: (justificativas[g.id] ?? '').trim(),
      })),
      justificativaGeral: justificativaGeral.trim(),
    }).finally(() => setSubmetendo(false));
  }

  if (passo === 1) {
    return (
      <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
            Passo 1 de 2 — Justificativas individuais
          </h3>
        </div>

        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     display: 'grid', gap: 'var(--s-5)' }}>
          {p.glosas.map((g) => (
            <li key={g.id} style={{
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              padding: 'var(--s-5)', background: 'var(--surface)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)',
                            marginBottom: 'var(--s-3)' }}>
                <span className="num" style={{
                  fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                  color: 'var(--text-muted)', fontSize: 'var(--fs-13)',
                }}>
                  {g.guiaNumero}
                </span>
                <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                  {g.pacienteNome}
                </span>
                <span className="num" style={{
                  fontSize: 'var(--fs-13)', fontVariantNumeric: 'tabular-nums',
                  color: 'var(--danger)', marginInlineStart: 'auto',
                }}>
                  {centavosParaReais(g.valorGlosadoCentavos)}
                </span>
              </div>
              <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                            marginBottom: 'var(--s-3)' }}>
                <span className="num" style={{ fontFamily: 'var(--font-mono)' }}>{g.codigoGlosa}</span>
                {' '}{g.descricaoGlosa}
              </div>
              <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
                <label htmlFor={`just-${g.id}`} style={{
                  fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
                  lineHeight: 1.3, color: 'var(--text-muted)',
                }}>
                  Justificativa
                </label>
                <textarea
                  id={`just-${g.id}`}
                  aria-label="Justificativa"
                  value={justificativas[g.id] ?? ''}
                  onChange={(e) => atualizarJustificativa(g.id, e.target.value)}
                  rows={3}
                  style={{
                    padding: 'var(--s-3) var(--s-4)',
                    border: 'var(--border)', borderRadius: 'var(--r-md)',
                    background: 'var(--surface)', color: 'var(--text)',
                    fontSize: 'var(--fs-14)', fontFamily: 'var(--font-ui)',
                    resize: 'vertical',
                  }}
                />
              </div>
            </li>
          ))}
        </ul>

        <div style={{ display: 'flex', gap: 'var(--s-3)', justifyContent: 'flex-end' }}>
          <Botao variante="fantasma" altura={32} onClick={p.aoCancelar}>
            Cancelar
          </Botao>
          <Botao variante="primario" altura={32}
            disabled={!todasPreenchidas}
            onClick={() => setPasso(2)}>
            Proximo
          </Botao>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
        Passo 2 de 2 — Revisar e submeter
      </h3>

      {/* Resumo */}
      <div style={{
        border: 'var(--border)', borderRadius: 'var(--r-md)',
        padding: 'var(--s-5)', background: 'var(--surface)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
          <span style={{ fontSize: 'var(--fs-14)', fontWeight: 'var(--fw-medium)' }}>
            {p.glosas.length} glosa(s)
          </span>
          <span className="num" style={{
            fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
            fontVariantNumeric: 'tabular-nums', color: 'var(--danger)',
          }}>
            {centavosParaReais(totalCentavos)}
          </span>
        </div>
      </div>

      {/* Justificativa geral */}
      <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
        <label htmlFor="justificativa-geral" style={{
          fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
          lineHeight: 1.3, color: 'var(--text-muted)',
        }}>
          Justificativa geral
        </label>
        <textarea
          id="justificativa-geral"
          aria-label="Justificativa geral"
          value={justificativaGeral}
          onChange={(e) => setJustificativaGeral(e.target.value)}
          rows={4}
          style={{
            padding: 'var(--s-3) var(--s-4)',
            border: 'var(--border)', borderRadius: 'var(--r-md)',
            background: 'var(--surface)', color: 'var(--text)',
            fontSize: 'var(--fs-14)', fontFamily: 'var(--font-ui)',
            resize: 'vertical',
          }}
        />
      </div>

      {/* Lista resumida das glosas com justificativas */}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                   border: 'var(--border)', borderRadius: 'var(--r-md)',
                   overflow: 'hidden', background: 'var(--surface-sunken)' }}>
        {p.glosas.map((g) => (
          <li key={g.id} style={{
            padding: 'var(--s-3) var(--s-4)',
            borderBottom: 'var(--border)', fontSize: 'var(--fs-12)',
          }}>
            <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center' }}>
              <span className="num" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                {g.guiaNumero}
              </span>
              <span>{g.pacienteNome}</span>
              <span className="num" style={{
                fontVariantNumeric: 'tabular-nums', color: 'var(--danger)',
                marginInlineStart: 'auto',
              }}>
                {centavosParaReais(g.valorGlosadoCentavos)}
              </span>
            </div>
            <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-muted)',
                        margin: 'var(--s-1) 0 0', lineHeight: 1.4 }}>
              {justificativas[g.id]}
            </p>
          </li>
        ))}
      </ul>

      <div style={{ display: 'flex', gap: 'var(--s-3)', justifyContent: 'flex-end' }}>
        <Botao variante="fantasma" altura={32} onClick={p.aoCancelar}>
          Cancelar
        </Botao>
        <Botao variante="secundario" altura={32} onClick={() => setPasso(1)}>
          Voltar
        </Botao>
        <Botao variante="primario" altura={32}
          carregando={submetendo}
          onClick={submeter}>
          Submeter
        </Botao>
      </div>
    </div>
  );
}
