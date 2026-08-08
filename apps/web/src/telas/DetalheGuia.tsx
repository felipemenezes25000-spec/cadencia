// apps/web/src/telas/DetalheGuia.tsx
'use client';

import { useState } from 'react';
import { PainelLateral } from '../ui/PainelLateral';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';

// -- Tipos ------------------------------------------------------------------

export interface AjusteGuia {
  readonly id: string;
  readonly campoAlterado: string;
  readonly valorAnterior: string;
  readonly valorNovo: string;
  readonly motivo: string;
  readonly autorNome: string;
  readonly criadoEm: string;
}

export interface GuiaDetalhe {
  readonly id: string;
  readonly numeroGuia: string;
  readonly pacienteNome: string;
  readonly numeroCns: string;
  readonly operadoraNome: string;
  readonly registroAns: string;
  readonly numeroCarteira: string;
  readonly atendimentoRn: boolean;
  readonly cnes: string;
  readonly conselhoProfissional: string;
  readonly numeroConselho: string;
  readonly ufConselho: string;
  readonly cbos: string;
  readonly indicacaoAcidente: string;
  readonly regimeAtendimento: string;
  readonly tipoConsulta: string;
  readonly codigoTabela: string;
  readonly codigoProcedimento: string;
  readonly nomeProcedimento: string;
  readonly valorCentavos: number;
  readonly dataAtendimento: string;
  readonly observacao: string | null;
  readonly ajustes: readonly AjusteGuia[];
}

export interface AjusteInput {
  readonly guiaId: string;
  readonly campoAlterado: string;
  readonly valorNovo: string;
  readonly motivo: string;
}

export interface DetalheGuiaProps {
  readonly aberto: boolean;
  readonly guia: GuiaDetalhe;
  readonly aoFechar: () => void;
  readonly aoAjustar: (input: AjusteInput) => Promise<void>;
}

// -- Helpers ----------------------------------------------------------------

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

const CAMPOS_AJUSTAVEIS: readonly { value: string; label: string }[] = [
  { value: 'codigo_procedimento', label: 'Codigo do procedimento' },
  { value: 'codigo_tabela', label: 'Codigo da tabela' },
  { value: 'valor_procedimento', label: 'Valor do procedimento' },
  { value: 'tipo_consulta', label: 'Tipo de consulta' },
  { value: 'regime_atendimento', label: 'Regime de atendimento' },
  { value: 'cbos', label: 'CBOS' },
];

// -- Linhas de dados --------------------------------------------------------

function LinhaInfo({ rotulo, valor }: { readonly rotulo: string; readonly valor: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between',
                  padding: 'var(--s-2) 0', borderBottom: 'var(--border)' }}>
      <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                     textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {rotulo}
      </span>
      <span className="num" style={{ fontSize: 'var(--fs-14)', fontFamily: 'var(--font-mono)',
                                      fontVariantNumeric: 'tabular-nums' }}>
        {valor}
      </span>
    </div>
  );
}

// -- Componente -------------------------------------------------------------

export function DetalheGuia(p: DetalheGuiaProps) {
  const [ajustando, setAjustando] = useState(false);
  const [campoAlterado, setCampoAlterado] = useState('');
  const [valorNovo, setValorNovo] = useState('');
  const [motivo, setMotivo] = useState('');

  function limparAjuste(): void {
    setCampoAlterado('');
    setValorNovo('');
    setMotivo('');
    setAjustando(false);
  }

  function confirmarAjuste(): void {
    void p.aoAjustar({
      guiaId: p.guia.id,
      campoAlterado,
      valorNovo,
      motivo,
    }).then(limparAjuste);
  }

  return (
    <PainelLateral
      aberto={p.aberto}
      titulo={`Guia ${p.guia.numeroGuia}`}
      aoFechar={p.aoFechar}
    >
      <div style={{ display: 'grid', gap: 'var(--s-6)', marginTop: 'var(--s-4)' }}>
        {/* Dados do paciente */}
        <div>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                         textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Paciente
          </span>
          <p style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-medium)',
                      margin: 'var(--s-1) 0 0' }}>
            {p.guia.pacienteNome}
          </p>
        </div>

        {/* Dados da operadora */}
        <div>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                         textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Operadora
          </span>
          <p style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-medium)',
                      margin: 'var(--s-1) 0 0' }}>
            {p.guia.operadoraNome}
          </p>
        </div>

        {/* Dados estruturados */}
        <div style={{ display: 'grid', gap: 0 }}>
          <LinhaInfo rotulo="Carteira" valor={p.guia.numeroCarteira} />
          <div style={{ display: 'flex', justifyContent: 'space-between',
                        padding: 'var(--s-2) 0', borderBottom: 'var(--border)' }}>
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                           textTransform: 'uppercase', letterSpacing: '.04em' }}>
              Procedimento
            </span>
            <span style={{ fontSize: 'var(--fs-14)' }}>
              {p.guia.nomeProcedimento}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between',
                        padding: 'var(--s-2) 0', borderBottom: 'var(--border)' }}>
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                           textTransform: 'uppercase', letterSpacing: '.04em' }}>
              Valor
            </span>
            <span className="num" style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                                            fontVariantNumeric: 'tabular-nums' }}>
              {centavosParaReais(p.guia.valorCentavos)}
            </span>
          </div>
          <LinhaInfo rotulo="Data" valor={p.guia.dataAtendimento} />
          <LinhaInfo rotulo="CNES" valor={p.guia.cnes} />
          <div style={{ display: 'flex', justifyContent: 'space-between',
                        padding: 'var(--s-2) 0', borderBottom: 'var(--border)' }}>
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                           textTransform: 'uppercase', letterSpacing: '.04em' }}>
              Conselho
            </span>
            <span className="num" style={{ fontSize: 'var(--fs-14)', fontFamily: 'var(--font-mono)',
                                            fontVariantNumeric: 'tabular-nums' }}>
              <span>{p.guia.conselhoProfissional}</span>{' '}
              <span>{p.guia.numeroConselho}</span>{' '}
              <span>{p.guia.ufConselho}</span>
            </span>
          </div>
          <LinhaInfo rotulo="CBOS" valor={p.guia.cbos} />
          <LinhaInfo rotulo="Tabela" valor={p.guia.codigoTabela} />
        </div>

        {/* Botao ajustar */}
        {!ajustando ? (
          <Botao variante="secundario" altura={32} onClick={() => setAjustando(true)}>
            Ajustar
          </Botao>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--s-4)',
                        padding: 'var(--s-4)', border: 'var(--border)',
                        borderRadius: 'var(--r-md)', background: 'var(--surface-sunken)' }}>
            <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
              <label htmlFor="ajuste-campo" style={{
                fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
                lineHeight: 1.3, color: 'var(--text-muted)',
              }}>
                Campo alterado
              </label>
              <select
                id="ajuste-campo" value={campoAlterado}
                onChange={(e) => setCampoAlterado(e.target.value)}
                aria-label="Campo alterado"
                style={{
                  height: 32, padding: '0 var(--s-4)',
                  border: 'var(--border)', borderRadius: 'var(--r-md)',
                  background: 'var(--surface)', color: 'var(--text)',
                  fontSize: 'var(--fs-14)',
                }}
              >
                <option value="">Selecione</option>
                {CAMPOS_AJUSTAVEIS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <Campo rotulo="Novo valor" value={valorNovo}
              onChange={(e) => setValorNovo(e.target.value)}
              aria-label="Novo valor" />
            <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
              <label htmlFor="ajuste-motivo" style={{
                fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
                lineHeight: 1.3, color: 'var(--text-muted)',
              }}>
                Motivo
              </label>
              <textarea
                id="ajuste-motivo" value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                aria-label="Motivo" required
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
            <div style={{ display: 'flex', gap: 'var(--s-3)' }}>
              <Botao variante="primario" altura={32} onClick={confirmarAjuste}>
                Confirmar ajuste
              </Botao>
              <Botao variante="fantasma" altura={32} onClick={limparAjuste}>
                Cancelar
              </Botao>
            </div>
          </div>
        )}

        {/* Historico de ajustes */}
        {p.guia.ajustes.length > 0 ? (
          <section aria-label="Historico de ajustes" style={{ display: 'grid', gap: 'var(--s-3)' }}>
            <h3 style={{ fontSize: 'var(--fs-13)', fontWeight: 'var(--fw-semibold)',
                         textTransform: 'uppercase', letterSpacing: '.04em',
                         color: 'var(--text-muted)', margin: 0 }}>
              Historico de ajustes
            </h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                         border: 'var(--border)', borderRadius: 'var(--r-sm)',
                         overflow: 'hidden', background: 'var(--surface-sunken)' }}>
              {p.guia.ajustes.map((aj) => (
                <li key={aj.id} style={{
                  padding: 'var(--s-3) var(--s-4)', borderBottom: 'var(--border)',
                  fontSize: 'var(--fs-13)',
                }}>
                  <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'baseline' }}>
                    <span className="num" style={{ fontFamily: 'var(--font-mono)',
                                                    fontVariantNumeric: 'tabular-nums',
                                                    color: 'var(--accent)' }}>
                      {aj.campoAlterado}
                    </span>
                    <span className="num" style={{ fontFamily: 'var(--font-mono)',
                                                    fontVariantNumeric: 'tabular-nums',
                                                    textDecoration: 'line-through',
                                                    color: 'var(--text-faint)' }}>
                      {aj.valorAnterior}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>&rarr;</span>
                    <span className="num" style={{ fontFamily: 'var(--font-mono)',
                                                    fontVariantNumeric: 'tabular-nums' }}>
                      {aj.valorNovo}
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-muted)', marginTop: 'var(--s-1)' }}>
                    {aj.motivo}
                  </div>
                  <div style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-11)',
                                marginTop: 'var(--s-1)' }}>
                    <span>{aj.autorNome}</span>{' — '}<span>{aj.criadoEm}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </PainelLateral>
  );
}
