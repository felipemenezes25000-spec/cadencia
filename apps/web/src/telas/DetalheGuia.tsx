// apps/web/src/telas/DetalheGuia.tsx
'use client';

import { useState } from 'react';
import { PainelLateral } from '../ui/PainelLateral';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { cn } from '../lib/cn';

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
    <div className="flex justify-between py-1 border-b border-line">
      <span className="text-xs text-text-muted uppercase tracking-[0.04em]">
        {rotulo}
      </span>
      <span className="text-sm font-mono tabular-nums">
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
      largura="lg"
    >
      <div className="grid gap-4 mt-1">
        {/* Informacoes da guia */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-text">Informacoes da guia</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-text-muted">Paciente</dt>
            <dd className="text-text font-medium">{p.guia.pacienteNome}</dd>
            <dt className="text-text-muted">Operadora</dt>
            <dd className="text-text">{p.guia.operadoraNome}</dd>
            <dt className="text-text-muted">Procedimento</dt>
            <dd className="text-text">{p.guia.nomeProcedimento}</dd>
            <dt className="text-text-muted">Codigo</dt>
            <dd className="text-text font-mono text-xs tabular-nums">{p.guia.codigoProcedimento}</dd>
            <dt className="text-text-muted">Data</dt>
            <dd className="text-text font-mono text-xs tabular-nums">{p.guia.dataAtendimento}</dd>
            <dt className="text-text-muted">Valor</dt>
            <dd className="text-text font-mono font-semibold tabular-nums">
              {centavosParaReais(p.guia.valorCentavos)}
            </dd>
          </dl>
        </section>

        {/* Dados TISS */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-text">Dados TISS</h3>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface-raised p-3 font-mono text-xs">
            <div className="grid gap-0">
              <LinhaInfo rotulo="Carteira" valor={p.guia.numeroCarteira} />
              <LinhaInfo rotulo="CNES" valor={p.guia.cnes} />
              <div className="flex justify-between py-1 border-b border-line">
                <span className="text-xs text-text-muted uppercase tracking-[0.04em]">
                  Conselho
                </span>
                <span className="text-sm font-mono tabular-nums">
                  <span>{p.guia.conselhoProfissional}</span>{' '}
                  <span>{p.guia.numeroConselho}</span>{' '}
                  <span>{p.guia.ufConselho}</span>
                </span>
              </div>
              <LinhaInfo rotulo="CBOS" valor={p.guia.cbos} />
              <LinhaInfo rotulo="Tabela" valor={p.guia.codigoTabela} />
            </div>
          </div>
        </section>

        {/* Botao ajustar */}
        {!ajustando ? (
          <Botao variante="secundario" tamanho="md" onClick={() => setAjustando(true)}>
            Ajustar
          </Botao>
        ) : (
          <div className="grid gap-2 rounded-xl border border-line bg-surface-sunken p-3">
            <div className="grid gap-1">
              <label
                htmlFor="ajuste-campo"
                className="text-xs font-medium leading-tight text-text-muted"
              >
                Campo alterado
              </label>
              <select
                id="ajuste-campo"
                value={campoAlterado}
                onChange={(e) => setCampoAlterado(e.target.value)}
                aria-label="Campo alterado"
                className={cn(
                  'h-9 rounded-lg border border-line bg-surface px-2',
                  'bg-surface text-text text-sm',
                  'focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent',
                )}
              >
                <option value="">Selecione</option>
                {CAMPOS_AJUSTAVEIS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <Campo
              rotulo="Novo valor"
              value={valorNovo}
              onChange={(e) => setValorNovo(e.target.value)}
              aria-label="Novo valor"
            />
            <div className="grid gap-1">
              <label
                htmlFor="ajuste-motivo"
                className="text-xs font-medium leading-tight text-text-muted"
              >
                Motivo
              </label>
              <textarea
                id="ajuste-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                aria-label="Motivo"
                required
                rows={3}
                className={cn(
                  'rounded-lg border border-line bg-surface px-2.5 py-2',
                  'bg-surface text-text text-sm font-sans',
                  'resize-y',
                  'focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent',
                )}
              />
            </div>
            <div className="flex gap-1.5">
              <Botao variante="primario" tamanho="md" onClick={confirmarAjuste}>
                Confirmar ajuste
              </Botao>
              <Botao variante="fantasma" tamanho="md" onClick={limparAjuste}>
                Cancelar
              </Botao>
            </div>
          </div>
        )}

        {/* Historico de ajustes */}
        {p.guia.ajustes.length > 0 ? (
          <section aria-label="Historico de ajustes" className="grid gap-1.5">
            <h3 className="text-[length:var(--fs-13)] font-semibold uppercase tracking-[0.04em] text-text-muted m-0">
              Historico de ajustes
            </h3>
            <ul className="list-none m-0 p-0 border border-line rounded-sm overflow-hidden bg-surface-sunken">
              {p.guia.ajustes.map((aj) => (
                <li key={aj.id} className="px-2 py-1.5 border-b border-line text-[length:var(--fs-13)]">
                  <div className="flex gap-1.5 items-baseline">
                    <span className="font-mono tabular-nums text-accent">
                      {aj.campoAlterado}
                    </span>
                    <span className="font-mono tabular-nums line-through text-text-faint">
                      {aj.valorAnterior}
                    </span>
                    <span className="text-text-muted">&rarr;</span>
                    <span className="font-mono tabular-nums">
                      {aj.valorNovo}
                    </span>
                  </div>
                  <div className="text-text-muted mt-0.5">
                    {aj.motivo}
                  </div>
                  <div className="text-text-faint text-[length:var(--fs-11)] mt-0.5">
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
