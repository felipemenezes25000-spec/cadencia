'use client';

import { useId, useMemo, useState } from 'react';
import {
  CONDICOES_DA_FACE, CONDICOES_DO_DENTE, FACES,
  ROTULO_DA_CONDICAO_DA_FACE, ROTULO_DA_CONDICAO_DO_DENTE, ROTULO_DA_FACE,
  dentesDaDenticao, ehAnterior, escreverOdontograma, lerOdontograma,
  type CondicaoDaFace, type CondicaoDoDente, type Dente, type Denticao,
  type EstadoDoDente, type Face, type Odontograma as Doc,
/* Subpath, e não o barrel: `@cadencia/emr` importa @cadencia/db em draft.ts e
   finalize.ts, e a regra `web-nao-fala-com-banco` do arch:check proíbe essa
   aresta. O módulo do odontograma é puro — não importa nada. */
} from '@cadencia/emr/odontograma';
import { cn } from '../lib/cn';

export interface OdontogramaProps {
  readonly rotulo: string;
  /** `value_json` cru vindo do prontuário. */
  readonly valor: string;
  readonly aoMudar: (valorJson: string) => void;
  readonly somenteLeitura?: boolean;
}

/* ── Cor por condição ─────────────────────────────────────────────────── */

const COR_DA_FACE: Readonly<Record<CondicaoDaFace, string>> = {
  higida: 'var(--surface)',
  carie: 'var(--danger)',
  restauracao: 'var(--brand)',
  selante: 'var(--success)',
  fratura: 'var(--warning)',
};

/**
 * Cor sozinha não pode carregar significado (WCAG 1.4.1) e uma parcela dos
 * dentistas homens tem alguma deficiência de visão de cor. Cada condição
 * também tem um glifo, e o dente marcado ganha contorno diferente.
 */
const GLIFO_DA_CONDICAO: Readonly<Record<CondicaoDoDente, string>> = {
  higido: '',
  ausente: '×',
  extraido: '×',
  extracao_indicada: '!',
  implante: 'I',
  protese: 'P',
  raiz_residual: 'R',
  nao_erupcionado: '?',
};

/* ── Um dente ─────────────────────────────────────────────────────────── */

/** Mesial aponta para a linha média: quadrantes 1/4 e 5/8 a têm à direita. */
function mesialADireita(dente: Dente): boolean {
  const q = Math.floor(dente / 10);
  return q === 1 || q === 4 || q === 5 || q === 8;
}

function DenteSvg({ dente, estado }: {
  readonly dente: Dente;
  readonly estado: EstadoDoDente | undefined;
}) {
  const faces = estado?.faces ?? {};
  const cor = (f: Face) => (faces[f] === undefined ? 'var(--surface)' : COR_DA_FACE[faces[f]]);
  const dir = mesialADireita(dente);
  const corEsq = cor(dir ? 'distal' : 'mesial');
  const corDir = cor(dir ? 'mesial' : 'distal');
  const ausente = estado?.condicao === 'ausente' || estado?.condicao === 'extraido';
  const glifo = estado?.condicao === undefined ? '' : GLIFO_DA_CONDICAO[estado.condicao];

  return (
    <svg viewBox="0 0 40 40" className="h-9 w-9" aria-hidden focusable="false">
      <g stroke="var(--border-field)" strokeWidth="1.25" opacity={ausente ? 0.35 : 1}>
        <polygon points="0,0 40,0 28,12 12,12" fill={cor('vestibular')} />
        <polygon points="0,40 40,40 28,28 12,28" fill={cor('lingual')} />
        <polygon points="0,0 12,12 12,28 0,40" fill={corEsq} />
        <polygon points="40,0 28,12 28,28 40,40" fill={corDir} />
        <rect x="12" y="12" width="16" height="16" fill={cor('oclusal')} />
      </g>
      {glifo === '' ? null : (
        <text
          x="20" y="26" textAnchor="middle"
          fontSize="20" fontWeight="700" fill="var(--text-primary)"
        >
          {glifo}
        </text>
      )}
    </svg>
  );
}

/* ── Resumo textual de um dente, para leitor de tela ──────────────────── */

function descrever(dente: Dente, estado: EstadoDoDente | undefined): string {
  if (estado === undefined) return `Dente ${dente}, sem marcação`;
  const partes: string[] = [];
  if (estado.condicao !== undefined) partes.push(ROTULO_DA_CONDICAO_DO_DENTE[estado.condicao]);
  for (const face of FACES) {
    const c = estado.faces?.[face];
    if (c !== undefined) partes.push(`${ROTULO_DA_FACE[face]}: ${ROTULO_DA_CONDICAO_DA_FACE[c]}`);
  }
  if (estado.nota !== undefined) partes.push(`Nota: ${estado.nota}`);
  return partes.length === 0
    ? `Dente ${dente}, sem marcação`
    : `Dente ${dente}. ${partes.join('. ')}`;
}

/* ── Arcada ───────────────────────────────────────────────────────────── */

function Arcada({ dentes, doc, selecionado, aoSelecionar, rotulo }: {
  readonly dentes: readonly Dente[];
  readonly doc: Doc;
  readonly selecionado: Dente | null;
  readonly aoSelecionar: (d: Dente) => void;
  readonly rotulo: string;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        {rotulo}
      </p>
      <ul className="flex flex-wrap gap-0.5" aria-label={rotulo}>
        {dentes.map((d) => {
          const estado = doc.dentes[String(d)];
          const marcado = estado !== undefined;
          return (
            <li key={d}>
              <button
                type="button"
                onClick={() => aoSelecionar(d)}
                aria-pressed={selecionado === d}
                aria-label={descrever(d, estado)}
                className={cn(
                  'grid place-items-center rounded-md p-0.5 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1',
                  selecionado === d ? 'bg-accent-soft ring-2 ring-accent' : 'hover:bg-surface-hover',
                  marcado && selecionado !== d && 'ring-1 ring-line-strong',
                )}
              >
                <DenteSvg dente={d} estado={estado} />
                <span className="mt-0.5 font-mono text-[10px] leading-none text-text-muted">{d}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── Componente ───────────────────────────────────────────────────────── */

export function Odontograma({ rotulo, valor, aoMudar, somenteLeitura = false }: OdontogramaProps) {
  const doc = useMemo(() => lerOdontograma(valor), [valor]);
  const [selecionado, setSelecionado] = useState<Dente | null>(null);
  const idBase = useId();

  const dentes = dentesDaDenticao(doc.denticao);
  const superiores = dentes.filter((d) => {
    const q = Math.floor(d / 10);
    return q === 1 || q === 2 || q === 5 || q === 6;
  });
  const inferiores = dentes.filter((d) => !superiores.includes(d));

  function gravar(proximo: Doc) {
    aoMudar(escreverOdontograma(proximo));
  }

  function trocarDenticao(d: Denticao) {
    /* Trocar de arcada NÃO apaga marcação: um paciente em dentição mista pode
       voltar para permanente sem perder o que foi anotado nos decíduos. */
    gravar({ ...doc, denticao: d });
    setSelecionado(null);
  }

  /**
   * `undefined` aqui significa APAGAR a marcação, não "não mexer" — por isso a
   * mutação é montada campo a campo em vez de espalhada com spread: sob
   * `exactOptionalPropertyTypes`, `{...atual, condicao: undefined}` não é o
   * mesmo que omitir a chave, e o spread gravaria a chave com undefined.
   */
  function alterarDente(dente: Dente, mudanca: {
    readonly condicao?: CondicaoDoDente | undefined;
    readonly faces?: Partial<Record<Face, CondicaoDaFace>> | undefined;
    readonly nota?: string | undefined;
  }) {
    const chave = String(dente);
    const atual = doc.dentes[chave] ?? {};

    const condicao = 'condicao' in mudanca ? mudanca.condicao : atual.condicao;
    const faces = 'faces' in mudanca ? mudanca.faces : atual.faces;
    const nota = 'nota' in mudanca ? mudanca.nota : atual.nota;

    const proximo: EstadoDoDente = {
      ...(condicao === undefined ? {} : { condicao }),
      ...(faces === undefined || Object.keys(faces).length === 0 ? {} : { faces }),
      ...(nota === undefined || nota === '' ? {} : { nota }),
    };

    const limpo: Record<string, EstadoDoDente> = { ...doc.dentes };
    if (Object.keys(proximo).length === 0) delete limpo[chave];
    else limpo[chave] = proximo;

    gravar({ ...doc, dentes: limpo });
  }

  const estadoSel = selecionado === null ? undefined : doc.dentes[String(selecionado)];

  return (
    <fieldset className="grid gap-3" disabled={somenteLeitura}>
      <legend className="text-sm font-medium text-text">{rotulo}</legend>

      {/* Dentição */}
      <div className="flex flex-wrap items-center gap-2">
        <span id={`${idBase}-den`} className="text-xs text-text-muted">Dentição</span>
        <div role="group" aria-labelledby={`${idBase}-den`} className="flex gap-1">
          {(['permanente', 'decidua', 'mista'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => trocarDenticao(d)}
              aria-pressed={doc.denticao === d}
              className={cn(
                'rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors max-md:min-h-11',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                doc.denticao === d
                  ? 'border-accent bg-accent text-accent-on'
                  : 'border-line bg-surface text-text-muted hover:bg-surface-hover',
              )}
            >
              {d === 'permanente' ? 'Permanente' : d === 'decidua' ? 'Decídua' : 'Mista'}
            </button>
          ))}
        </div>
      </div>

      {/* Arcadas. Rola no celular em vez de espremer 16 dentes em 375px. */}
      <div className="-mx-1 overflow-x-auto px-1 scrollbar-thin">
        <div className="grid min-w-[560px] gap-3">
          <Arcada rotulo="Arcada superior" dentes={superiores} doc={doc}
            selecionado={selecionado} aoSelecionar={setSelecionado} />
          <Arcada rotulo="Arcada inferior" dentes={inferiores} doc={doc}
            selecionado={selecionado} aoSelecionar={setSelecionado} />
        </div>
      </div>

      {/* Editor do dente selecionado.
          As faces são marcadas AQUI, com controle rotulado, e não clicando na
          região de 8px do desenho: aquilo seria inalcançável no toque e mudo
          para leitor de tela. O desenho mostra o estado; este painel edita. */}
      {selecionado === null ? (
        <p className="rounded-[var(--r-md)] border border-dashed border-line px-3 py-2.5 text-xs text-text-muted">
          Selecione um dente para registrar condição, faces e observação.
        </p>
      ) : (
        <div className="grid gap-3 rounded-[var(--r-lg)] border border-line bg-surface-subtle p-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-text">
              Dente {selecionado}
              <span className="ml-2 font-normal text-text-muted">
                {ehAnterior(selecionado) ? 'anterior' : 'posterior'}
              </span>
            </h4>
            <button
              type="button"
              onClick={() => setSelecionado(null)}
              className="rounded-md px-2 py-1 text-xs text-text-muted hover:bg-surface-hover max-md:min-h-11 max-md:min-w-11"
            >
              Fechar
            </button>
          </div>

          {/* Condição do dente */}
          <div className="grid gap-1.5">
            <label htmlFor={`${idBase}-cond`} className="text-xs font-medium text-text-muted">
              Condição do dente
            </label>
            <select
              id={`${idBase}-cond`}
              value={estadoSel?.condicao ?? ''}
              onChange={(e) => alterarDente(selecionado, {
                condicao: e.target.value === '' ? undefined : e.target.value as CondicaoDoDente,
              })}
              className="h-10 rounded-[var(--r-md)] border border-line-field bg-surface px-2 text-sm max-md:min-h-11"
            >
              <option value="">Sem marcação</option>
              {CONDICOES_DO_DENTE.map((c) => (
                <option key={c} value={c}>{ROTULO_DA_CONDICAO_DO_DENTE[c]}</option>
              ))}
            </select>
          </div>

          {/* Faces */}
          <fieldset className="grid gap-1.5">
            <legend className="text-xs font-medium text-text-muted">Faces</legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {FACES.map((face) => {
                const id = `${idBase}-${face}`;
                const nomeDaFace = face === 'oclusal' && ehAnterior(selecionado)
                  ? 'Incisal'
                  : ROTULO_DA_FACE[face];
                return (
                  <div key={face} className="flex items-center gap-2">
                    <label htmlFor={id} className="min-w-[104px] text-xs text-text-muted">
                      {nomeDaFace}
                    </label>
                    <select
                      id={id}
                      value={estadoSel?.faces?.[face] ?? ''}
                      onChange={(e) => {
                        const faces = { ...(estadoSel?.faces ?? {}) };
                        if (e.target.value === '') delete faces[face];
                        else faces[face] = e.target.value as CondicaoDaFace;
                        alterarDente(selecionado, { faces });
                      }}
                      className="h-9 flex-1 rounded-[var(--r-md)] border border-line-field bg-surface px-2 text-sm max-md:min-h-11"
                    >
                      <option value="">—</option>
                      {CONDICOES_DA_FACE.map((c) => (
                        <option key={c} value={c}>{ROTULO_DA_CONDICAO_DA_FACE[c]}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </fieldset>

          {/* Nota */}
          <div className="grid gap-1.5">
            <label htmlFor={`${idBase}-nota`} className="text-xs font-medium text-text-muted">
              Observação
            </label>
            <input
              id={`${idBase}-nota`}
              type="text"
              maxLength={500}
              value={estadoSel?.nota ?? ''}
              onChange={(e) => alterarDente(selecionado, {
                nota: e.target.value === '' ? undefined : e.target.value,
              })}
              className="h-10 rounded-[var(--r-md)] border border-line-field bg-surface px-2.5 text-sm max-md:min-h-11"
            />
          </div>
        </div>
      )}

      {/* Legenda. Sem ela, a cor da face é adivinhação. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
        {CONDICOES_DA_FACE.filter((c) => c !== 'higida').map((c) => (
          <li key={c} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block size-3 rounded-sm border border-line-strong"
              style={{ background: COR_DA_FACE[c] }}
            />
            {ROTULO_DA_CONDICAO_DA_FACE[c]}
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
