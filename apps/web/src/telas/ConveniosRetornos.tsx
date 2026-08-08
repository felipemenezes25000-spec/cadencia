// apps/web/src/telas/ConveniosRetornos.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';

// -- Tipos ------------------------------------------------------------------

export interface Demonstrativo {
  readonly id: string;
  readonly operadoraNome: string;
  readonly operadoraId: string;
  readonly registroAns: string;
  readonly protocolo: string;
  readonly tipo: 'analise' | 'pagamento';
  readonly dataImportacao: string;
  readonly periodoInicio: string;
  readonly periodoFim: string;
  readonly totalApresentadoCentavos: number;
  readonly totalProcessadoCentavos: number;
  readonly totalLiberadoCentavos: number;
  readonly totalGlosadoCentavos: number;
  readonly totalItens: number;
  readonly itensGlosados: number;
}

export interface OperadoraResumo {
  readonly id: string;
  readonly nome: string;
  readonly registroAns: string;
}

export interface TotaisRetornos {
  readonly apresentadoCentavos: number;
  readonly processadoCentavos: number;
  readonly liberadoCentavos: number;
  readonly glosadoCentavos: number;
}

export interface RetornosDados {
  readonly demonstrativos: readonly Demonstrativo[];
  readonly operadoras: readonly OperadoraResumo[];
  readonly totais: TotaisRetornos;
}

export interface FiltrosRetornos {
  readonly operadoraId?: string;
  readonly tipo?: 'analise' | 'pagamento';
  readonly dataInicio?: string;
  readonly dataFim?: string;
}

export interface ConveniosRetornosProps {
  readonly carregarDados: (filtros: FiltrosRetornos) => Promise<RetornosDados>;
  readonly aoImportarXml: (arquivo: File) => Promise<void>;
  readonly aoAbrirDemonstrativo: (id: string) => void;
}

// -- Helpers ----------------------------------------------------------------

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

const ROTULOS_TOTAIS: { chave: keyof TotaisRetornos; rotulo: string }[] = [
  { chave: 'apresentadoCentavos', rotulo: 'Apresentado' },
  { chave: 'processadoCentavos', rotulo: 'Processado' },
  { chave: 'liberadoCentavos', rotulo: 'Liberado' },
  { chave: 'glosadoCentavos', rotulo: 'Glosado' },
];

const TIPO_CHIP: Record<'analise' | 'pagamento', { rotulo: string; cor: string; bg: string }> = {
  analise:    { rotulo: 'Analise',    cor: 'var(--accent)',  bg: 'var(--accent-soft)' },
  pagamento:  { rotulo: 'Pagamento',  cor: 'var(--ok)',      bg: 'var(--ok-soft)' },
};

// -- Componente -------------------------------------------------------------

export function ConveniosRetornos(p: ConveniosRetornosProps) {
  const [dados, setDados] = useState<RetornosDados | null>(null);
  const [operadoraId, setOperadoraId] = useState('');
  const [tipo, setTipo] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [importando, setImportando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void p.carregarDados({}).then(setDados);
  }, [p]);

  function filtrar(): void {
    void p.carregarDados({
      operadoraId: operadoraId === '' ? undefined : operadoraId,
      tipo: tipo === '' ? undefined : tipo as 'analise' | 'pagamento',
      dataInicio: dataInicio === '' ? undefined : dataInicio,
      dataFim: dataFim === '' ? undefined : dataFim,
    }).then(setDados);
  }

  function abrirDialogImportar(): void {
    fileRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const arquivo = e.target.files?.[0];
    if (arquivo === undefined) return;
    setImportando(true);
    void p.aoImportarXml(arquivo).finally(() => {
      setImportando(false);
      if (fileRef.current) fileRef.current.value = '';
      void p.carregarDados({}).then(setDados);
    });
  }

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      {/* Cabecalho */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          Retornos
        </h3>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".xml"
            onChange={handleFileChange}
            style={{ display: 'none' }}
            aria-label="Selecionar arquivo XML"
          />
          <Botao variante="primario" altura={32}
            onClick={abrirDialogImportar} carregando={importando}>
            Importar
          </Botao>
        </div>
      </div>

      {/* Totalizadores */}
      <div
        role="group" aria-label="Totalizadores de retornos" aria-live="polite"
        style={{ display: 'flex', border: 'var(--border)', borderRadius: 'var(--r-md)',
                 background: 'var(--surface)', overflow: 'hidden' }}
      >
        {ROTULOS_TOTAIS.map((t, i) => (
          <div
            key={t.chave}
            style={{
              flex: 1,
              borderInlineStart: i === 0 ? 'none' : '1px solid var(--line)',
              padding: `var(--s-5) var(--s-4)`,
              display: 'grid', gap: 'var(--s-1)', justifyItems: 'start',
            }}
          >
            <span className="num" style={{ fontSize: '28px', fontWeight: 600, lineHeight: 1.1,
                                           color: t.chave === 'glosadoCentavos' && dados.totais[t.chave] > 0
                                             ? 'var(--danger)' : 'var(--text)' }}>
              {centavosParaReais(dados.totais[t.chave])}
            </span>
            <span style={{ fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                           letterSpacing: '.04em', color: 'var(--text-muted)' }}>
              {t.rotulo}
            </span>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap', alignItems: 'end' }}>
        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <label htmlFor="filtro-operadora-ret" style={{
            fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
            lineHeight: 1.3, color: 'var(--text-muted)',
          }}>
            Operadora
          </label>
          <select
            id="filtro-operadora-ret"
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

        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <label htmlFor="filtro-tipo-ret" style={{
            fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
            lineHeight: 1.3, color: 'var(--text-muted)',
          }}>
            Tipo
          </label>
          <select
            id="filtro-tipo-ret"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            aria-label="Tipo"
            style={{
              height: 32, padding: '0 var(--s-4)',
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              background: 'var(--surface)', color: 'var(--text)',
              fontSize: 'var(--fs-14)',
            }}
          >
            <option value="">Todos</option>
            <option value="analise">Analise</option>
            <option value="pagamento">Pagamento</option>
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

      {/* Lista de demonstrativos */}
      <section aria-label="Demonstrativos importados">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.demonstrativos.map((d) => {
            const chip = TIPO_CHIP[d.tipo];
            return (
              <li key={d.id} style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                alignItems: 'center', gap: 'var(--s-4)',
                padding: 'var(--s-4) var(--s-5)',
                borderBottom: 'var(--border)', minHeight: 56,
              }}>
                <div
                  role="button" tabIndex={0}
                  onClick={() => p.aoAbrirDemonstrativo(d.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      p.aoAbrirDemonstrativo(d.id);
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                    <span className="num" style={{
                      fontSize: 'var(--fs-13)', fontVariantNumeric: 'tabular-nums',
                      color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                    }}>
                      {d.protocolo}
                    </span>
                    <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                      {d.operadoraNome}
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
                    {d.itensGlosados > 0 ? (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center',
                        fontSize: 'var(--fs-11)', fontWeight: 'var(--fw-medium)',
                        padding: 'var(--s-1) var(--s-4)',
                        borderRadius: 'var(--r-full)',
                        color: 'var(--danger)', background: 'var(--danger-soft)',
                      }}>
                        {d.itensGlosados} glosa(s)
                      </span>
                    ) : null}
                  </div>
                  <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                                 color: 'var(--text-muted)' }}>
                    {d.periodoInicio} a {d.periodoFim} — {d.totalItens} iten(s) — Importado em {d.dataImportacao}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 'var(--s-6)', alignItems: 'baseline' }}>
                  <div style={{ textAlign: 'right' }}>
                    <span className="num" style={{
                      fontSize: 'var(--fs-14)', fontWeight: 'var(--fw-medium)',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {centavosParaReais(d.totalLiberadoCentavos)}
                    </span>
                    <span style={{ display: 'block', fontSize: 'var(--fs-11)',
                                   color: 'var(--text-muted)' }}>
                      liberado
                    </span>
                  </div>
                  {d.totalGlosadoCentavos > 0 ? (
                    <div style={{ textAlign: 'right' }}>
                      <span className="num" style={{
                        fontSize: 'var(--fs-14)', fontWeight: 'var(--fw-medium)',
                        fontVariantNumeric: 'tabular-nums', color: 'var(--danger)',
                      }}>
                        {centavosParaReais(d.totalGlosadoCentavos)}
                      </span>
                      <span style={{ display: 'block', fontSize: 'var(--fs-11)',
                                     color: 'var(--text-muted)' }}>
                        glosado
                      </span>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
