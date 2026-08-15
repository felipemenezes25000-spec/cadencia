// apps/web/src/ui/PainelDeDocumentos.tsx
'use client';

import { useState } from 'react';
import { FileText, Printer, Warning } from '@phosphor-icons/react';
import { PainelLateral } from './PainelLateral';
import { Botao } from './Botao';
import { cn } from '../lib/cn';

export type TipoDeDocumento =
  | 'atestado' | 'declaracao_comparecimento' | 'pedido_exame' | 'relatorio';

export interface PainelDeDocumentosProps {
  readonly aberto: boolean;
  readonly pacienteNome: string;
  readonly aoEmitir: (dados: { kind: TipoDeDocumento; corpo: string })
    => Promise<{
      documentId: string;
      urlPdf: string;
      /** Falso quando não há PSC ICP-Brasil: o documento sai PENDENTE. */
      assinado: boolean;
      motivo?: string;
    }>;
  readonly aoFechar: () => void;
}

interface Modelo {
  readonly id: TipoDeDocumento;
  readonly rotulo: string;
  readonly texto: (paciente: string) => string;
}

/**
 * Os quatro documentos do dia a dia, já redigidos.
 *
 * O texto padrão não é enfeite: atestado em branco faz o médico redigir a mesma
 * frase dez vezes por dia, e frase escrita com pressa é frase que esquece o
 * período de afastamento — que é justamente o que o empregador vai cobrar.
 * O texto continua editável; o padrão só tira o custo do caso comum.
 */
const MODELOS: readonly Modelo[] = [
  {
    id: 'atestado', rotulo: 'Atestado',
    texto: (p) => `Atesto para os devidos fins que ${p} esteve sob meus cuidados `
      + `profissionais nesta data, necessitando de afastamento de suas atividades `
      + `por ___ (___) dias a partir de hoje.`,
  },
  {
    id: 'declaracao_comparecimento', rotulo: 'Declaração de comparecimento',
    texto: (p) => `Declaro para os devidos fins que ${p} compareceu a esta `
      + `unidade nesta data, no período das ___h às ___h, para atendimento.`,
  },
  {
    id: 'pedido_exame', rotulo: 'Pedido de exame',
    texto: () => `Solicito:\n\n- \n- \n\nHipótese diagnóstica: `,
  },
  {
    id: 'relatorio', rotulo: 'Relatório',
    texto: (p) => `Relatório referente ao acompanhamento de ${p}.\n\n`,
  },
];

export function PainelDeDocumentos(p: PainelDeDocumentosProps) {
  const primeiro = MODELOS[0]!;
  const [tipo, setTipo] = useState<TipoDeDocumento>(primeiro.id);
  const [corpo, setCorpo] = useState(() => primeiro.texto(p.pacienteNome));
  const [erro, setErro] = useState<string | null>(null);
  const [emitindo, setEmitindo] = useState(false);
  const [emitido, setEmitido] = useState<
    { documentId: string; urlPdf: string; assinado: boolean } | null>(null);

  function trocarTipo(novo: TipoDeDocumento): void {
    const modelo = MODELOS.find((m) => m.id === novo);
    if (modelo === undefined) return;
    setTipo(novo);
    setCorpo(modelo.texto(p.pacienteNome));
    setErro(null);
    setEmitido(null);
  }

  async function emitir(): Promise<void> {
    if (corpo.trim() === '') {
      // Corpo vazio não é "documento simples": é o hash selando o nada e a
      // assinatura do médico valendo para uma folha em branco.
      setErro('Escreva o texto do documento antes de emitir.');
      return;
    }
    setErro(null);
    setEmitindo(true);
    try {
      setEmitido(await p.aoEmitir({ kind: tipo, corpo: corpo.trim() }));
    } catch {
      setErro('Não foi possível emitir o documento. Tente de novo.');
    } finally {
      setEmitindo(false);
    }
  }

  return (
    <PainelLateral aberto={p.aberto} titulo="Emitir documento" aoFechar={p.aoFechar}>
      <div className="grid gap-4">
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium text-text">Tipo</legend>
          <div className="grid gap-1.5">
            {MODELOS.map((m) => (
              <label
                key={m.id}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-[var(--r-sm)]',
                  'border border-line px-3 py-2 text-sm transition',
                  tipo === m.id ? 'border-accent bg-surface-raised' : 'hover:bg-surface-hover',
                )}
              >
                <input
                  type="radio"
                  name="tipo-documento"
                  value={m.id}
                  checked={tipo === m.id}
                  onChange={() => trocarTipo(m.id)}
                  className="accent-[var(--accent)]"
                />
                <span>{m.rotulo}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-text">Texto do documento</span>
          <textarea
            value={corpo}
            onChange={(e) => { setCorpo(e.target.value); setErro(null); }}
            rows={9}
            className={cn(
              'w-full resize-y rounded-[var(--r-sm)] border border-line bg-surface',
              'p-3 font-doc text-sm leading-relaxed text-text',
              'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
            )}
          />
        </label>

        {erro !== null && (
          <p role="alert" className="text-sm text-danger">{erro}</p>
        )}

        {emitido === null ? (
          <Botao
            iconeEsquerda={FileText}
            onClick={() => emitir()}
            disabled={emitindo}
          >
            {emitindo ? 'Emitindo…' : 'Emitir'}
          </Botao>
        ) : (
          <div className="grid gap-2 rounded-[var(--r-sm)] border border-line bg-surface-raised p-3">
            {emitido.assinado ? (
              <p className="text-sm text-text">Documento emitido e registrado no prontuário.</p>
            ) : (
              <p
                role="alert"
                className="flex items-start gap-2 text-sm text-danger"
              >
                <Warning size={18} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>
                  Emitido <strong>sem assinatura</strong> digital e registrado como
                  pendente. Sem certificado ICP-Brasil, empregador e INSS podem
                  recusar. Assine quando o certificado estiver disponível.
                </span>
              </p>
            )}
            <a
              href={emitido.urlPdf}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm font-medium text-accent underline"
            >
              <Printer size={16} weight="bold" aria-hidden="true" />
              Abrir para imprimir
            </a>
          </div>
        )}
      </div>
    </PainelLateral>
  );
}
