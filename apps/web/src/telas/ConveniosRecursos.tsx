// apps/web/src/telas/ConveniosRecursos.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';

// -- Tipos ------------------------------------------------------------------

export type StatusRecurso = 'rascunho' | 'enviado' | 'aceito' | 'negado' | 'parcial';

export interface ItemRecurso {
  readonly id: string;
  readonly glosaId: string;
  readonly guiaNumero: string;
  readonly pacienteNome: string;
  readonly codigoGlosa: string;
  readonly valorGlosadoCentavos: number;
  readonly justificativa: string;
}

export interface Recurso {
  readonly id: string;
  readonly operadoraNome: string;
  readonly operadoraId: string;
  readonly status: StatusRecurso;
  readonly justificativaGeral: string;
  readonly criadoEm: string;
  readonly enviadoEm: string | null;
  readonly totalGlosasCentavos: number;
  readonly itens: readonly ItemRecurso[];
}

export interface RecursosDados {
  readonly recursos: readonly Recurso[];
}

export interface ConveniosRecursosProps {
  readonly carregarDados: () => Promise<RecursosDados>;
  readonly aoEditar: (recursoId: string) => void;
  readonly aoEnviar: (recursoId: string) => Promise<void>;
  readonly aoVerResultado: (recursoId: string) => void;
}

// -- Helpers ----------------------------------------------------------------

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

const STATUS_CHIP: Record<StatusRecurso, { rotulo: string; glifo: string; cor: string; bg: string }> = {
  rascunho: { rotulo: 'Rascunho', glifo: '●', cor: 'var(--text-muted)', bg: 'var(--surface-sunken)' },
  enviado:  { rotulo: 'Enviado',  glifo: '↑', cor: 'var(--accent)',      bg: 'var(--accent-soft)' },
  aceito:   { rotulo: 'Aceito',   glifo: '✓', cor: 'var(--ok)',          bg: 'var(--ok-soft)' },
  negado:   { rotulo: 'Negado',   glifo: '✕', cor: 'var(--danger)',      bg: 'var(--danger-soft)' },
  parcial:  { rotulo: 'Parcial',  glifo: '◐', cor: 'var(--warn)',        bg: 'var(--warn-soft)' },
};

// -- Componente -------------------------------------------------------------

export function ConveniosRecursos(p: ConveniosRecursosProps) {
  const [dados, setDados] = useState<RecursosDados | null>(null);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  useEffect(() => {
    void p.carregarDados().then(setDados);
  }, [p]);

  function alternarExpandir(id: string): void {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
        Recursos
      </h3>

      <section aria-label="Lista de recursos de glosa">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.recursos.map((rec) => {
            const chip = STATUS_CHIP[rec.status];
            const expandido = expandidos.has(rec.id);

            return (
              <li key={rec.id} style={{ borderBottom: 'var(--border)' }}>
                {/* Cabecalho do recurso */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto auto',
                  alignItems: 'center', gap: 'var(--s-4)',
                  padding: 'var(--s-5) var(--s-5)', minHeight: 56,
                }}>
                  {/* Expandir */}
                  <button
                    type="button"
                    onClick={() => alternarExpandir(rec.id)}
                    aria-expanded={expandido}
                    aria-label="Expandir"
                    style={{
                      border: 0, background: 'transparent', cursor: 'pointer',
                      fontSize: 'var(--fs-14)', color: 'var(--text-muted)',
                      width: 24, height: 24, display: 'flex', alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {expandido ? '▾' : '▸'}
                  </button>

                  {/* Info do recurso */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                      <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                        {rec.operadoraNome}
                      </span>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)',
                        fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
                        fontWeight: 'var(--fw-medium)', padding: 'var(--s-1) var(--s-4)',
                        borderRadius: 'var(--r-full)',
                        color: chip.cor, background: chip.bg,
                      }}>
                        <span aria-hidden="true">{chip.glifo}</span>{chip.rotulo}
                      </span>
                    </div>
                    <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                                   color: 'var(--text-muted)' }}>
                      {rec.itens.length} glosa(s) — Criado em {rec.criadoEm}
                      {rec.enviadoEm !== null ? ` — Env. ${rec.enviadoEm}` : ''}
                    </span>
                  </div>

                  {/* Valor total */}
                  <span className="num" style={{
                    fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                    fontVariantNumeric: 'tabular-nums', color: 'var(--danger)',
                  }}>
                    {centavosParaReais(rec.totalGlosasCentavos)}
                  </span>

                  {/* Acoes */}
                  <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
                    {rec.status === 'rascunho' ? (
                      <>
                        <Botao variante="secundario" altura={28}
                          onClick={() => { p.aoEditar(rec.id); }}>
                          Editar
                        </Botao>
                        <Botao variante="primario" altura={28}
                          onClick={() => { void p.aoEnviar(rec.id); }}>
                          Enviar
                        </Botao>
                      </>
                    ) : null}
                    {rec.status === 'enviado' || rec.status === 'aceito'
                      || rec.status === 'negado' || rec.status === 'parcial' ? (
                      <Botao variante="secundario" altura={28}
                        onClick={() => { p.aoVerResultado(rec.id); }}>
                        Ver resultado
                      </Botao>
                    ) : null}
                  </div>
                </div>

                {/* Itens expandidos */}
                {expandido && rec.itens.length > 0 ? (
                  <div style={{ padding: '0 var(--s-5) var(--s-5)',
                                paddingInlineStart: 'calc(var(--s-5) + 24px + var(--s-4))' }}>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                                 border: 'var(--border)', borderRadius: 'var(--r-sm)',
                                 overflow: 'hidden', background: 'var(--surface-sunken)' }}>
                      {rec.itens.map((item) => (
                        <li key={item.id} style={{
                          padding: 'var(--s-4) var(--s-4)',
                          borderBottom: 'var(--border)',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)',
                                        marginBottom: 'var(--s-2)' }}>
                            <span className="num" style={{
                              fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                              color: 'var(--text-muted)', fontSize: 'var(--fs-13)',
                            }}>
                              {item.guiaNumero}
                            </span>
                            <span style={{ fontSize: 'var(--fs-13)', fontWeight: 'var(--fw-medium)' }}>
                              {item.pacienteNome}
                            </span>
                            <span className="num" style={{
                              fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)',
                              color: 'var(--text-muted)',
                            }}>
                              {item.codigoGlosa}
                            </span>
                            <span className="num" style={{
                              fontSize: 'var(--fs-13)', fontWeight: 'var(--fw-medium)',
                              fontVariantNumeric: 'tabular-nums', color: 'var(--danger)',
                              marginInlineStart: 'auto',
                            }}>
                              {centavosParaReais(item.valorGlosadoCentavos)}
                            </span>
                          </div>
                          <p style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                                      margin: 0, lineHeight: 1.5 }}>
                            {item.justificativa}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
