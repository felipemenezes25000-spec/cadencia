// apps/web/src/telas/ConveniosGlosas.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';

// -- Tipos ------------------------------------------------------------------

export type StatusGlosa = 'pendente' | 'recurso_enviado' | 'recurso_aceito' | 'recurso_negado';

export interface Glosa {
  readonly id: string;
  readonly demonstrativoId: string;
  readonly guiaNumero: string;
  readonly pacienteNome: string;
  readonly operadoraNome: string;
  readonly operadoraId: string;
  readonly codigoProcedimento: string;
  readonly nomeProcedimento: string;
  readonly codigoGlosa: string;
  readonly descricaoGlosa: string;
  readonly valorApresentadoCentavos: number;
  readonly valorGlosadoCentavos: number;
  readonly dataAtendimento: string;
  readonly status: StatusGlosa;
}

export interface OperadoraResumo {
  readonly id: string;
  readonly nome: string;
  readonly registroAns: string;
}

export interface GlosasDados {
  readonly glosas: readonly Glosa[];
  readonly operadoras: readonly OperadoraResumo[];
  readonly totalGlosadoPendenteCentavos: number;
}

export interface FiltrosGlosas {
  readonly status?: StatusGlosa;
  readonly operadoraId?: string;
  readonly dataInicio?: string;
  readonly dataFim?: string;
}

export interface ConveniosGlosasProps {
  readonly carregarDados: (filtros: FiltrosGlosas) => Promise<GlosasDados>;
  readonly aoCriarRecurso: (glosaIds: readonly string[]) => void;
}

// -- Helpers ----------------------------------------------------------------

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

const STATUS_CHIP: Record<StatusGlosa, { rotulo: string; cor: string; bg: string }> = {
  pendente:        { rotulo: 'Pendente',        cor: 'var(--warn)',     bg: 'var(--warn-soft)' },
  recurso_enviado: { rotulo: 'Recurso enviado', cor: 'var(--accent)',   bg: 'var(--accent-soft)' },
  recurso_aceito:  { rotulo: 'Recurso aceito',  cor: 'var(--ok)',       bg: 'var(--ok-soft)' },
  recurso_negado:  { rotulo: 'Recurso negado',  cor: 'var(--danger)',   bg: 'var(--danger-soft)' },
};

// -- Componente -------------------------------------------------------------

export function ConveniosGlosas(p: ConveniosGlosasProps) {
  const [dados, setDados] = useState<GlosasDados | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [statusFiltro, setStatusFiltro] = useState('');
  const [operadoraId, setOperadoraId] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  useEffect(() => {
    void p.carregarDados({}).then(setDados);
  }, [p]);

  function filtrar(): void {
    void p.carregarDados({
      status: statusFiltro === '' ? undefined : statusFiltro as StatusGlosa,
      operadoraId: operadoraId === '' ? undefined : operadoraId,
      dataInicio: dataInicio === '' ? undefined : dataInicio,
      dataFim: dataFim === '' ? undefined : dataFim,
    }).then(setDados);
  }

  function alternarSelecao(id: string): void {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      {/* Cabecalho com badge de pendente */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
          <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
            Glosas
          </h3>
          {dados.totalGlosadoPendenteCentavos > 0 ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)',
              fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
              padding: 'var(--s-1) var(--s-4)',
              borderRadius: 'var(--r-full)',
              color: 'var(--danger)', background: 'var(--danger-soft)',
            }}>
              {centavosParaReais(dados.totalGlosadoPendenteCentavos)} pendente
            </span>
          ) : null}
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap', alignItems: 'end' }}>
        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <label htmlFor="filtro-status-gl" style={{
            fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
            lineHeight: 1.3, color: 'var(--text-muted)',
          }}>
            Status
          </label>
          <select
            id="filtro-status-gl"
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value)}
            aria-label="Status"
            style={{
              height: 32, padding: '0 var(--s-4)',
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              background: 'var(--surface)', color: 'var(--text)',
              fontSize: 'var(--fs-14)',
            }}
          >
            <option value="">Todos</option>
            <option value="pendente">Pendente</option>
            <option value="recurso_enviado">Recurso enviado</option>
            <option value="recurso_aceito">Recurso aceito</option>
            <option value="recurso_negado">Recurso negado</option>
          </select>
        </div>

        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <label htmlFor="filtro-operadora-gl" style={{
            fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
            lineHeight: 1.3, color: 'var(--text-muted)',
          }}>
            Operadora
          </label>
          <select
            id="filtro-operadora-gl"
            value={operadoraId}
            onChange={(e) => setOperadoraId(e.target.value)}
            aria-label="Operadora"
            style={{
              height: 32, padding: '0 var(--s-4)',
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              background: 'var(--surface)', color: 'var(--text)',
              fontSize: 'var(--fs-14)',
            }}
          >
            <option value="">Todas</option>
            {dados.operadoras.map((op) => (
              <option key={op.id} value={op.id}>{op.nome}</option>
            ))}
          </select>
        </div>

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

      {/* Barra de acao batch */}
      {selecionadas.size > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)',
                      padding: 'var(--s-3) var(--s-5)',
                      background: 'var(--accent-soft)', borderRadius: 'var(--r-md)' }}>
          <span style={{ fontSize: 'var(--fs-13)', color: 'var(--text)' }}>
            {selecionadas.size} glosa(s) selecionada(s)
          </span>
          <Botao variante="primario" altura={32}
            onClick={() => { p.aoCriarRecurso(Array.from(selecionadas)); }}>
            Criar recurso
          </Botao>
        </div>
      ) : null}

      {/* Lista de glosas */}
      <section aria-label="Lista de glosas">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.glosas.map((g) => {
            const chip = STATUS_CHIP[g.status];
            const selecionavel = g.status === 'pendente';

            return (
              <li key={g.id} style={{
                display: 'grid',
                gridTemplateColumns: selecionavel ? 'auto 1fr auto' : '1fr auto',
                alignItems: 'center', gap: 'var(--s-4)',
                padding: 'var(--s-4) var(--s-5)',
                borderBottom: 'var(--border)', minHeight: 56,
              }}>
                {selecionavel ? (
                  <input
                    type="checkbox"
                    checked={selecionadas.has(g.id)}
                    onChange={() => alternarSelecao(g.id)}
                    aria-label={`Selecionar glosa ${g.guiaNumero}`}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                ) : null}

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                    <span className="num" style={{
                      fontSize: 'var(--fs-13)', fontVariantNumeric: 'tabular-nums',
                      color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                    }}>
                      {g.guiaNumero}
                    </span>
                    <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                      {g.pacienteNome}
                    </span>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center',
                      fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
                      fontWeight: 'var(--fw-medium)', padding: 'var(--s-1) var(--s-4)',
                      borderRadius: 'var(--r-full)',
                      color: chip.cor, background: chip.bg,
                    }}>
                      {chip.rotulo}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)',
                                fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
                    <span className="num" style={{ fontFamily: 'var(--font-mono)' }}>{g.codigoGlosa}</span>
                    <span>{g.descricaoGlosa}</span>
                    <span>—</span>
                    <span>{g.operadoraNome}</span>
                    <span>—</span>
                    <span>{g.dataAtendimento}</span>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <span className="num" style={{
                    fontSize: 'var(--fs-14)', fontWeight: 'var(--fw-medium)',
                    fontVariantNumeric: 'tabular-nums', color: 'var(--danger)',
                  }}>
                    {centavosParaReais(g.valorGlosadoCentavos)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
