// apps/web/src/ui/FichaClinica.tsx
'use client';

import { useEffect, useState } from 'react';
import { cn } from '../lib/cn';
import { Odontograma } from './Odontograma';
import type { CampoDaFicha, SecaoDaFicha } from '../lib/ficha-tipos';

export type { ComponenteDoCampo, CampoDaFicha, SecaoDaFicha } from '../lib/ficha-tipos';

export interface FichaClinicaProps {
  readonly secoes: readonly SecaoDaFicha[];
  /**
   * Valores por chave. Campo simples usa `fieldId`; componente de campo composto
   * usa `fieldId:OBSERVATION_CODE`, porque é o observation_code que vira linha
   * em clin.observation.
   */
  readonly valores: Readonly<Record<string, string>>;
  readonly aoMudar: (chave: string, valor: string) => void;
  readonly buscarCodigo: (termo: string) => Promise<readonly {
    code: string; display: string }[]>;
}

/**
 * Os campos ESTRUTURADOS do prontuário, renderizados a partir da configuração
 * da clínica — não de uma lista fixa no código.
 *
 * Sem esta ficha, o template instanciado fica configurado e inalcançável: a
 * barra lateral promete alergias que nenhuma tela escreve, e sinais vitais
 * declarados nunca viram série numérica. O texto livre do editor não substitui:
 * "PA 120x80" escrito na evolução não gera gráfico, nem alerta, nem relatório.
 */

const CLASSE_ENTRADA = cn(
  'w-full rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm',
  'text-text focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
);

/* ── busca em tabela de referência (CID-10, TUSS) ─────────────────────── */

function BuscaEmTabela({ campo, valor, aoMudar, buscarCodigo }: {
  readonly campo: CampoDaFicha;
  readonly valor: string;
  readonly aoMudar: (chave: string, valor: string) => void;
  readonly buscarCodigo: FichaClinicaProps['buscarCodigo'];
}) {
  const [termo, setTermo] = useState('');
  const [hits, setHits] = useState<readonly { code: string; display: string }[]>([]);

  useEffect(() => {
    // Menos de dois caracteres devolveria meio catálogo e não ajuda ninguém.
    if (termo.trim().length < 2) { setHits([]); return undefined; }
    let vivo = true;
    const t = setTimeout(() => {
      void buscarCodigo(termo).then((r) => { if (vivo) setHits(r); }).catch(() => {
        if (vivo) setHits([]);
      });
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [termo, buscarCodigo]);

  const escolhido = valor === '' ? null : valor.split('|');

  return (
    <div className="grid gap-1.5">
      <label className="text-sm font-medium text-text" htmlFor={campo.fieldId}>
        {campo.label}
      </label>
      {escolhido !== null ? (
        <div className="flex items-center justify-between gap-2 rounded-[var(--r-sm)] border border-accent bg-surface-raised px-3 py-2 text-sm">
          <span>
            <strong className="font-mono">{escolhido[0]}</strong>
            {escolhido[1] !== undefined && <span className="ml-2">{escolhido[1]}</span>}
          </span>
          <button
            type="button"
            className="text-xs text-text-muted underline"
            onClick={() => { aoMudar(campo.fieldId, ''); setTermo(''); }}
          >
            trocar
          </button>
        </div>
      ) : (
        <>
          <input
            id={campo.fieldId}
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Código ou descrição"
            className={CLASSE_ENTRADA}
          />
          {hits.length > 0 && (
            <ul className="grid gap-0.5 rounded-[var(--r-sm)] border border-line bg-surface p-1">
              {hits.slice(0, 8).map((h) => (
                <li key={h.code}>
                  <button
                    type="button"
                    onClick={() => {
                      // Código E descrição. O display_snapshot da versão selada
                      // precisa do texto VIGENTE na época do atendimento, não do
                      // que o catálogo tiver daqui a cinco anos.
                      aoMudar(campo.fieldId, `${h.code}|${h.display}`);
                      setHits([]);
                    }}
                    className="block w-full rounded-[var(--r-sm)] px-2 py-1.5 text-left text-sm hover:bg-surface-hover"
                  >
                    <span className="font-mono text-xs">{h.code}</span>
                    <span className="ml-2">{h.display}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/* ── um campo ─────────────────────────────────────────────────────────── */

function Campo({ campo, valores, aoMudar, buscarCodigo }: {
  readonly campo: CampoDaFicha;
  readonly valores: Readonly<Record<string, string>>;
  readonly aoMudar: (chave: string, valor: string) => void;
  readonly buscarCodigo: FichaClinicaProps['buscarCodigo'];
}) {
  const valor = valores[campo.fieldId] ?? '';

  if (campo.kind === 'busca_tabela') {
    return (
      <BuscaEmTabela campo={campo} valor={valor} aoMudar={aoMudar}
        buscarCodigo={buscarCodigo} />
    );
  }

  if (campo.kind === 'composto') {
    return (
      <fieldset className="grid gap-1.5">
        <legend className="text-sm font-medium text-text">{campo.label}</legend>
        <div className="flex gap-2">
          {campo.componentes.map((k) => {
            const chave = `${campo.fieldId}:${k.observationCode}`;
            return (
              <label key={k.observationCode} className="grid flex-1 gap-1">
                <span className="text-xs text-text-muted">{k.label}</span>
                <span className="flex items-center gap-1.5">
                  <input
                    inputMode="decimal"
                    value={valores[chave] ?? ''}
                    onChange={(e) => aoMudar(chave, e.target.value)}
                    className={CLASSE_ENTRADA}
                  />
                  {k.unit !== null && (
                    <span className="shrink-0 text-xs text-text-muted">{k.unit}</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }

  if (campo.kind === 'numerico' || campo.kind === 'imc') {
    return (
      <label className="grid gap-1.5" htmlFor={campo.fieldId}>
        <span className="text-sm font-medium text-text">{campo.label}</span>
        <span className="flex items-center gap-1.5">
          <input
            id={campo.fieldId}
            inputMode="decimal"
            value={valor}
            onChange={(e) => aoMudar(campo.fieldId, e.target.value)}
            className={CLASSE_ENTRADA}
          />
          {/* A unidade fica na tela: "70" sozinho pode ser kg ou lb, e o gráfico
              de evolução de peso é construído em cima desse número. */}
          {campo.unit !== null && (
            <span className="shrink-0 text-xs text-text-muted">{campo.unit}</span>
          )}
        </span>
      </label>
    );
  }

  if (campo.kind === 'texto_longo') {
    return (
      <label className="grid gap-1.5" htmlFor={campo.fieldId}>
        <span className="text-sm font-medium text-text">{campo.label}</span>
        <textarea
          id={campo.fieldId}
          rows={3}
          value={valor}
          onChange={(e) => aoMudar(campo.fieldId, e.target.value)}
          className={cn(CLASSE_ENTRADA, 'resize-y')}
        />
      </label>
    );
  }

  if (campo.kind === 'texto_curto' || campo.kind === 'data') {
    return (
      <label className="grid gap-1.5" htmlFor={campo.fieldId}>
        <span className="text-sm font-medium text-text">{campo.label}</span>
        <input
          id={campo.fieldId}
          type={campo.kind === 'data' ? 'date' : 'text'}
          value={valor}
          onChange={(e) => aoMudar(campo.fieldId, e.target.value)}
          className={CLASSE_ENTRADA}
        />
      </label>
    );
  }

  if (campo.kind === 'lista_unica' && campo.options !== null) {
    return (
      <label className="grid gap-1.5" htmlFor={campo.fieldId}>
        <span className="text-sm font-medium text-text">{campo.label}</span>
        <select
          id={campo.fieldId}
          value={valor}
          onChange={(e) => aoMudar(campo.fieldId, e.target.value)}
          className={CLASSE_ENTRADA}
        >
          <option value="">—</option>
          {campo.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
  }

  if (campo.kind === 'booleano') {
    return (
      <label className="flex items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          checked={valor === 'true'}
          onChange={(e) => aoMudar(campo.fieldId, e.target.checked ? 'true' : 'false')}
          className="accent-[var(--accent)]"
        />
        {campo.label}
      </label>
    );
  }

  if (campo.kind === 'multipla_escolha' && campo.options !== null) {
    /* Cada marcação vira UMA linha de encounter_field_value com ordinal
       próprio, e promove para clin.encounter_finding — é isso que torna a
       comorbidade consultável. Guardado como lista separada por `|`, porque o
       contrato desta tela é string; quem finaliza explode em linhas.
       Uma caixa de texto livre aqui deixaria a clínica sem conseguir listar os
       próprios diabéticos. */
    const marcados = valor === '' ? [] : valor.split('|');
    return (
      <fieldset className="grid gap-1.5">
        <legend className="text-sm font-medium text-text">{campo.label}</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {campo.options.map((o) => {
            const id = `${campo.fieldId}:${o}`;
            const marcado = marcados.includes(o);
            return (
              <label key={o} htmlFor={id}
                className="flex items-center gap-2 rounded-[var(--r-sm)] px-1 py-1 text-sm text-text max-md:min-h-11">
                <input
                  id={id}
                  type="checkbox"
                  checked={marcado}
                  onChange={(e) => {
                    /* Preserva a ordem declarada no catálogo em vez da ordem de
                       clique: o prontuário fica estável entre versões. */
                    const proximo = e.target.checked
                      ? campo.options!.filter((x) => x === o || marcados.includes(x))
                      : marcados.filter((x) => x !== o);
                    aoMudar(campo.fieldId, proximo.join('|'));
                  }}
                  className="accent-[var(--accent)]"
                />
                {o}
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }

  if (campo.kind === 'odontograma') {
    return (
      <Odontograma
        rotulo={campo.label}
        valor={valor}
        aoMudar={(json) => aoMudar(campo.fieldId, json)}
      />
    );
  }

  // Tipo ainda sem renderização. Sumir com o campo faria a clínica achar que
  // configurou algo que existe e o dado nunca ser coletado, sem ninguém notar.
  return (
    <p className="rounded-[var(--r-sm)] border border-dashed border-line px-3 py-2 text-xs text-text-muted">
      <strong>{campo.label}</strong> ({campo.kind}) ainda não é preenchível por
      esta tela. O campo continua configurado e nada foi perdido.
    </p>
  );
}

/* ── a ficha ──────────────────────────────────────────────────────────── */

export function FichaClinica(p: FichaClinicaProps) {
  // A seção da evolução narrativa é o editor de texto, e não entra aqui: teria
  // duas caixas para a mesma coisa e o médico escreveria em uma das duas.
  const secoes = p.secoes.filter((s) => s.code !== 'evolucao');
  if (secoes.length === 0) return null;

  return (
    <div className="grid gap-5">
      {secoes.map((s) => (
        <fieldset key={s.sectionId} className="grid gap-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            {s.label}
          </legend>
          {s.campos.map((c) => (
            <Campo key={c.fieldId} campo={c} valores={p.valores}
              aoMudar={p.aoMudar} buscarCodigo={p.buscarCodigo} />
          ))}
        </fieldset>
      ))}
    </div>
  );
}
