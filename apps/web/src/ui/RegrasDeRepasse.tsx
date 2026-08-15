// apps/web/src/ui/RegrasDeRepasse.tsx
'use client';

import { useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import { Botao } from './Botao';

export interface RegraDeRepasse {
  readonly id: string;
  readonly professionalId: string;
  readonly procedureId: string | null;
  readonly conventionName: string | null;
  readonly percentage: number | null;
  readonly fixedAmountCents: number | null;
  readonly priority: number;
  readonly active: boolean;
}

export interface NovaRegra {
  readonly professionalId: string;
  readonly conventionName?: string;
  readonly percentage?: number;
  readonly fixedAmountCents?: number;
  readonly priority: number;
}

export interface RegrasDeRepasseProps {
  readonly regras: readonly RegraDeRepasse[];
  readonly profissionais: readonly { professionalId: string; nome: string }[];
  readonly aoCriar: (r: NovaRegra) => Promise<void>;
}

function reais(centavos: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
  }).format(centavos / 100);
}

function paraCentavos(texto: string): number {
  const limpo = texto.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = Number.parseFloat(limpo);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * Cadastro das regras de repasse.
 *
 * A tela `/financeiro/repasse` mostrava o RESULTADO do rateio e as regras que o
 * produzem não tinham onde ser cadastradas — a clínica via quanto cada
 * profissional recebeu sem poder mudar a conta que gerou aquilo.
 *
 * A regra é lida em português, não em colunas: "60% para a Dra. Helena, em
 * qualquer convênio, prioridade 1". Mostrar `percentage: 60, convention: null`
 * obrigaria quem cadastra a decorar o significado de cada nulo.
 */
export function RegrasDeRepasse(p: RegrasDeRepasseProps) {
  const [professionalId, setProfessionalId] = useState('');
  const [convenio, setConvenio] = useState('');
  const [percentual, setPercentual] = useState('');
  const [valorFixo, setValorFixo] = useState('');
  const [prioridade, setPrioridade] = useState('1');
  const [salvando, setSalvando] = useState(false);

  const temPercentual = percentual.trim() !== '';
  const temFixo = valorFixo.trim() !== '';
  // Os dois preenchidos é ambiguidade pura: o backend teria de escolher, e
  // qualquer escolha dele surpreende quem cadastrou.
  const ambos = temPercentual && temFixo;
  const pct = Number(percentual);
  const percentualInvalido = temPercentual && (!Number.isFinite(pct) || pct <= 0 || pct > 100);

  const incompleto = professionalId === '' || ambos || percentualInvalido
    || (!temPercentual && !temFixo);

  const nomeDe = (id: string): string =>
    p.profissionais.find((x) => x.professionalId === id)?.nome ?? id;

  async function criar(): Promise<void> {
    setSalvando(true);
    try {
      await p.aoCriar({
        professionalId,
        priority: Number(prioridade) || 1,
        ...(convenio.trim() === '' ? {} : { conventionName: convenio.trim() }),
        ...(temPercentual ? { percentage: pct } : {}),
        ...(temFixo ? { fixedAmountCents: paraCentavos(valorFixo) } : {}),
      });
      setPercentual(''); setValorFixo(''); setConvenio('');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-5 sm:items-end">
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-text">Profissional</span>
          <select value={professionalId}
            onChange={(e) => setProfessionalId(e.target.value)}
            className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text">
            <option value="">Escolha</option>
            {p.profissionais.map((x) => (
              <option key={x.professionalId} value={x.professionalId}>{x.nome}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-text">Convênio (opcional)</span>
          <input type="text" value={convenio} placeholder="Qualquer"
            onChange={(e) => setConvenio(e.target.value)}
            className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text" />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-text">Percentual</span>
          <input type="text" inputMode="decimal" value={percentual} placeholder="60"
            onChange={(e) => setPercentual(e.target.value)}
            className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text" />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-text">Valor fixo</span>
          <input type="text" inputMode="decimal" value={valorFixo} placeholder="120,00"
            onChange={(e) => setValorFixo(e.target.value)}
            className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text" />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-text">Prioridade</span>
          <input type="number" min={1} value={prioridade}
            onChange={(e) => setPrioridade(e.target.value)}
            className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text" />
        </label>
      </div>

      {ambos && (
        <p role="alert" className="text-sm text-danger">
          Preencha <strong>um dos dois</strong>: percentual ou valor fixo. Com os
          dois, não há como saber qual vale.
        </p>
      )}
      {percentualInvalido && (
        <p role="alert" className="text-sm text-danger">
          Percentual tem de ficar entre 1 e 100 — repassar mais que 100% faria a
          clínica pagar para atender.
        </p>
      )}

      <div>
        <Botao iconeEsquerda={Plus} disabled={incompleto} carregando={salvando}
          onClick={() => criar()}>
          Adicionar regra
        </Botao>
      </div>

      {p.regras.length === 0 ? (
        <p className="text-sm text-text-muted">
          Sem regra cadastrada, <strong>nenhum repasse será calculado</strong> —
          o rateio sai zerado para todo mundo.
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {p.regras.map((r) => (
            <li key={r.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm">
              <span className="font-semibold text-text">
                {r.percentage !== null
                  ? `${r.percentage}%`
                  : reais(r.fixedAmountCents ?? 0)}
              </span>
              <span className="text-text">para {nomeDe(r.professionalId)}</span>
              {/* `null` em convênio significa QUALQUER. Célula vazia pareceria
                  cadastro incompleto. */}
              <span className="text-text-muted">
                · {r.conventionName ?? 'qualquer convênio'}
              </span>
              {/* Duas regras podem casar com o mesmo atendimento. Sem ver a
                  prioridade, ninguém entende por que o repasse saiu 60%. */}
              <span className="ml-auto text-xs text-text-muted">
                prioridade {r.priority}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
