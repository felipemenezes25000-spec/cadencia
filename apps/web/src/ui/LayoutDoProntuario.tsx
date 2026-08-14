// apps/web/src/ui/LayoutDoProntuario.tsx
'use client';

import { useState } from 'react';
import { CaretUp, CaretDown, ArrowCounterClockwise } from '@phosphor-icons/react';
import { Botao } from './Botao';

export interface SecaoDoLayout {
  readonly sectionId: string;
  readonly code: string;
  readonly label: string;
  readonly ordinal: number;
  readonly visible: boolean;
  readonly collapsed: boolean;
  /** false = ainda segue o padrão da clínica. */
  readonly personalizado: boolean;
}

export interface ItemSalvo {
  readonly sectionId: string;
  readonly ordinal: number;
  readonly visible: boolean;
  readonly collapsed: boolean;
}

export interface LayoutDoProntuarioProps {
  readonly secoes: readonly SecaoDoLayout[];
  /** Lista VAZIA volta ao padrão da clínica. */
  readonly aoSalvar: (itens: readonly ItemSalvo[]) => Promise<void>;
}

/**
 * Cada médico arruma o próprio prontuário.
 *
 * `clin.record_layout_item` existia no banco desde a Fase 1 — com índice,
 * unicidade por (profissional, seção) e tudo — e nunca teve uma linha. Todo
 * médico via as seções na ordem da clínica, e o ortopedista abria
 * "antecedentes ginecológicos" no topo em toda consulta.
 *
 * Setas e não arrastar: uma lista de seis a dez seções reordena mais rápido com
 * dois cliques do que com drag, funciona no teclado sem trabalho extra e não
 * quebra no celular. Arrastar seria mais bonito e menos útil.
 */
export function LayoutDoProntuario(p: LayoutDoProntuarioProps) {
  const [ordem, setOrdem] = useState<SecaoDoLayout[]>(() => [...p.secoes]);
  const [mexeu, setMexeu] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const nenhumaVisivel = ordem.every((s) => !s.visible);
  const jaPersonalizado = p.secoes.some((s) => s.personalizado);

  function mover(indice: number, passo: -1 | 1): void {
    const alvo = indice + passo;
    if (alvo < 0 || alvo >= ordem.length) return;
    const copia = [...ordem];
    const a = copia[indice]!;
    const b = copia[alvo]!;
    copia[indice] = b;
    copia[alvo] = a;
    setOrdem(copia);
    setMexeu(true);
  }

  function alternarVisivel(sectionId: string): void {
    setOrdem((atual) => atual.map(
      (s) => (s.sectionId === sectionId ? { ...s, visible: !s.visible } : s)));
    setMexeu(true);
  }

  async function salvar(itens: readonly ItemSalvo[]): Promise<void> {
    setSalvando(true);
    try {
      await p.aoSalvar(itens);
      setMexeu(false);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-muted">
          {jaPersonalizado
            ? 'Esta é a sua ordem. A clínica pode mudar o padrão dela sem afetar isto.'
            : 'Seguindo a ordem da clínica. Mexer aqui vale só para você.'}
        </p>
        {jaPersonalizado && (
          <Botao variante="fantasma" tamanho="sm"
            iconeEsquerda={ArrowCounterClockwise}
            carregando={salvando}
            // Lista vazia apaga a personalização: a partir daí o médico volta a
            // receber as mudanças que a clínica fizer no padrão.
            onClick={() => { void salvar([]); }}>
            Voltar ao padrão da clínica
          </Botao>
        )}
      </div>

      <ul className="grid gap-1">
        {ordem.map((s, i) => (
          <li key={s.sectionId}
            className="flex items-center gap-2 rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm">
            <span className="w-6 text-center text-xs tabular-nums text-text-muted">
              {i + 1}
            </span>
            <span className={`flex-1 ${s.visible ? 'text-text' : 'text-text-muted line-through'}`}>
              {s.label}
            </span>

            <label className="flex items-center gap-1.5 text-xs text-text-muted">
              <input type="checkbox" checked={s.visible}
                onChange={() => alternarVisivel(s.sectionId)}
                className="accent-[var(--accent)]" />
              Mostrar
            </label>

            <button type="button" aria-label={`Subir ${s.label}`}
              disabled={i === 0}
              onClick={() => mover(i, -1)}
              className="rounded p-1 text-text-muted hover:bg-surface-hover disabled:opacity-30 max-md:min-h-11 max-md:min-w-11 max-md:inline-grid max-md:place-items-center">
              <CaretUp size={16} aria-hidden="true" />
            </button>
            <button type="button" aria-label={`Descer ${s.label}`}
              disabled={i === ordem.length - 1}
              onClick={() => mover(i, 1)}
              className="rounded p-1 text-text-muted hover:bg-surface-hover disabled:opacity-30 max-md:min-h-11 max-md:min-w-11 max-md:inline-grid max-md:place-items-center">
              <CaretDown size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>

      {nenhumaVisivel && (
        <p role="alert" className="text-sm text-danger">
          Deixe <strong>pelo menos uma</strong> seção visível — a ficha sem
          nenhuma é uma tela de atendimento em branco.
        </p>
      )}

      <div>
        <Botao
          // Salvar sem mudança gravaria um layout idêntico ao padrão, e a partir
          // daí o médico deixaria de receber as mudanças da clínica.
          disabled={!mexeu || nenhumaVisivel}
          carregando={salvando}
          onClick={() => { void salvar(ordem.map((s, i) => ({
            sectionId: s.sectionId,
            // Renumerado de 1 a N: buraco de ordinal deixaria a próxima
            // reordenação ambígua.
            ordinal: i + 1,
            visible: s.visible,
            collapsed: s.collapsed,
          }))); }}>
          Salvar minha ordem
        </Botao>
      </div>
    </section>
  );
}
