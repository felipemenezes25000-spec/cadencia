// apps/web/src/telas/FormRecursoGlosa.tsx
'use client';

import { useState } from 'react';
import { Botao } from '../ui/Botao';
import { cn } from '../lib/cn';

// -- Tipos ------------------------------------------------------------------

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

// -- Helpers ----------------------------------------------------------------

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

// -- Componente -------------------------------------------------------------

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
      <div className="grid gap-4">
        <div className="flex justify-between items-center">
          <h3 className="text-[length:var(--fs-15)] font-semibold m-0">
            Passo 1 de 2 — Justificativas individuais
          </h3>
        </div>

        <ul className="list-none m-0 p-0 grid gap-3">
          {p.glosas.map((g) => (
            <li
              key={g.id}
              className="border border-line rounded-md p-3 bg-surface"
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="font-mono tabular-nums text-text-muted text-[length:var(--fs-13)]">
                  {g.guiaNumero}
                </span>
                <span className="font-medium text-sm">
                  {g.pacienteNome}
                </span>
                <span className="text-[length:var(--fs-13)] tabular-nums text-danger ml-auto">
                  {centavosParaReais(g.valorGlosadoCentavos)}
                </span>
              </div>
              <div className="text-xs text-text-muted mb-1.5">
                <span className="font-mono">{g.codigoGlosa}</span>
                {' '}{g.descricaoGlosa}
              </div>
              <div className="grid gap-1">
                <label
                  htmlFor={`just-${g.id}`}
                  className="text-xs font-medium leading-tight text-text-muted"
                >
                  Justificativa
                </label>
                <textarea
                  id={`just-${g.id}`}
                  aria-label="Justificativa"
                  value={justificativas[g.id] ?? ''}
                  onChange={(e) => atualizarJustificativa(g.id, e.target.value)}
                  rows={3}
                  className={cn(
                    'px-2 py-1.5 border border-line rounded-md',
                    'bg-surface text-text text-sm font-sans',
                    'resize-y',
                    'focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent',
                  )}
                />
              </div>
            </li>
          ))}
        </ul>

        <div className="flex gap-1.5 justify-end">
          <Botao variante="fantasma" tamanho="md" onClick={p.aoCancelar}>
            Cancelar
          </Botao>
          <Botao
            variante="primario"
            tamanho="md"
            disabled={!todasPreenchidas}
            onClick={() => setPasso(2)}
          >
            Proximo
          </Botao>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <h3 className="text-[length:var(--fs-15)] font-semibold m-0">
        Passo 2 de 2 — Revisar e submeter
      </h3>

      {/* Resumo */}
      <div className="border border-line rounded-md p-3 bg-surface">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {p.glosas.length} glosa(s)
          </span>
          <span className="text-[length:var(--fs-15)] font-semibold tabular-nums text-danger">
            {centavosParaReais(totalCentavos)}
          </span>
        </div>
      </div>

      {/* Justificativa geral */}
      <div className="grid gap-1">
        <label
          htmlFor="justificativa-geral"
          className="text-xs font-medium leading-tight text-text-muted"
        >
          Justificativa geral
        </label>
        <textarea
          id="justificativa-geral"
          aria-label="Justificativa geral"
          value={justificativaGeral}
          onChange={(e) => setJustificativaGeral(e.target.value)}
          rows={4}
          className={cn(
            'px-2 py-1.5 border border-line rounded-md',
            'bg-surface text-text text-sm font-sans',
            'resize-y',
            'focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent',
          )}
        />
      </div>

      {/* Lista resumida das glosas com justificativas */}
      <ul className="list-none m-0 p-0 border border-line rounded-md overflow-hidden bg-surface-sunken">
        {p.glosas.map((g) => (
          <li key={g.id} className="px-2 py-1.5 border-b border-line text-xs">
            <div className="flex gap-1.5 items-center">
              <span className="font-mono text-text-muted">
                {g.guiaNumero}
              </span>
              <span>{g.pacienteNome}</span>
              <span className="tabular-nums text-danger ml-auto">
                {centavosParaReais(g.valorGlosadoCentavos)}
              </span>
            </div>
            <p className="text-[length:var(--fs-11)] text-text-muted mt-0.5 mb-0 leading-snug">
              {justificativas[g.id]}
            </p>
          </li>
        ))}
      </ul>

      <div className="flex gap-1.5 justify-end">
        <Botao variante="fantasma" tamanho="md" onClick={p.aoCancelar}>
          Cancelar
        </Botao>
        <Botao variante="secundario" tamanho="md" onClick={() => setPasso(1)}>
          Voltar
        </Botao>
        <Botao
          variante="primario"
          tamanho="md"
          carregando={submetendo}
          onClick={submeter}
        >
          Submeter
        </Botao>
      </div>
    </div>
  );
}
