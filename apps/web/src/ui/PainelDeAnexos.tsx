// apps/web/src/ui/PainelDeAnexos.tsx
'use client';

import { useState } from 'react';
import { FileArrowDown, Paperclip } from '@phosphor-icons/react';
import { PainelLateral } from './PainelLateral';
import { InfoTip } from './ClinicalHelp';
import { cn } from '../lib/cn';

export interface Anexo {
  readonly attachmentId: string;
  readonly kind: string;
  readonly originalName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly criadoEm: string;
  readonly requestDocumentId?: string | null;
  readonly pedidoTitulo?: string | null;
}

export interface PedidoExamePendente {
  readonly documentId: string;
  readonly titulo: string;
  readonly issuedDate: string;
  readonly encounterId: string | null;
  readonly resultados: number;
}

export interface PainelDeAnexosProps {
  readonly aberto: boolean;
  readonly anexos: readonly Anexo[];
  readonly pedidosExamePendentes?: readonly PedidoExamePendente[];
  readonly aoEnviar: (dados: {
    arquivo: File;
    kind: string;
    requestDocumentId?: string;
  }) => Promise<void>;
  readonly aoAbrir: (attachmentId: string) => Promise<void>;
  readonly aoFechar: () => void;
}

/** 20 MB — o mesmo teto da API. Barrar aqui poupa a subida inteira. */
const LIMITE_BYTES = 20 * 1024 * 1024;

const TIPOS: readonly { id: string; rotulo: string; descricao: string }[] = [
  {
    id: 'resultado_exame',
    rotulo: 'Resultado de exame',
    descricao: 'Laudo ou resultado recebido. Quando houver pedido pendente, vincule-o à solicitação correspondente.',
  },
  { id: 'imagem', rotulo: 'Imagem', descricao: 'Foto, imagem clínica ou material visual relacionado ao cuidado.' },
  { id: 'documento_externo', rotulo: 'Documento externo', descricao: 'Documento clínico produzido fora desta unidade ou sistema.' },
  { id: 'consentimento', rotulo: 'Termo de consentimento', descricao: 'Termo assinado ou evidência documental de consentimento.' },
  { id: 'outro', rotulo: 'Outro', descricao: 'Arquivo clínico que não se enquadra nas categorias anteriores.' },
];

const ROTULO_KIND = Object.fromEntries(TIPOS.map((t) => [t.id, t.rotulo]));

function tamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} MB`;
}

function dataCurta(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(new Date(iso));
}

/**
 * Arquivos clínicos do prontuário. Resultado de exame é vinculado ao pedido
 * sempre que existe uma solicitação pendente — o arquivo deixa de ser um PDF
 * solto e passa a fechar o ciclo pedido -> resultado.
 */
export function PainelDeAnexos(p: PainelDeAnexosProps) {
  const [kind, setKind] = useState(TIPOS[0]!.id);
  const [requestDocumentId, setRequestDocumentId] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [abrindo, setAbrindo] = useState<string | null>(null);

  const pedidosPendentes = p.pedidosExamePendentes ?? [];
  const tipoAtual = TIPOS.find((t) => t.id === kind) ?? TIPOS[0]!;
  const resultadoComPedidoObrigatorio = kind === 'resultado_exame' && pedidosPendentes.length > 0;

  async function escolher(f: File | undefined): Promise<void> {
    if (f === undefined) return;
    setErro(null);
    if (resultadoComPedidoObrigatorio && requestDocumentId === '') {
      setErro('Selecione primeiro o pedido de exame correspondente.');
      return;
    }
    if (f.size === 0) {
      setErro('Arquivo vazio.');
      return;
    }
    if (f.size > LIMITE_BYTES) {
      setErro(`Arquivo maior que 20 MB (${tamanho(f.size)}). Reduza ou envie por outro meio.`);
      return;
    }
    setEnviando(true);
    try {
      await p.aoEnviar({
        arquivo: f,
        kind,
        ...(kind === 'resultado_exame' && requestDocumentId !== '' ? { requestDocumentId } : {}),
      });
      if (kind === 'resultado_exame') setRequestDocumentId('');
    } catch {
      setErro('Não foi possível enviar. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <PainelLateral aberto={p.aberto} titulo="Anexos do prontuário" aoFechar={p.aoFechar}>
      <div className="grid gap-4">
        <div className="flex items-start gap-3 rounded-xl border border-accent/15 bg-accent-soft/35 px-3.5 py-3">
          <InfoTip
            conteudo="Classifique o arquivo corretamente. Resultados de exame podem ser vinculados ao pedido original para manter o histórico rastreável."
            rotulo="Como organizar anexos"
            className="mt-0.5"
          />
          <div>
            <p className="m-0 text-xs font-bold text-text">Organize o arquivo antes de enviar</p>
            <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
              Tipo, pedido de origem e data ficam visíveis no prontuário. Limite por arquivo: 20 MB.
            </p>
          </div>
        </div>

        <div className="grid gap-1.5 text-sm">
          <div className="flex items-center gap-2">
            <label htmlFor="tipo-anexo-clinico" className="font-semibold text-text">Tipo do arquivo</label>
            <InfoTip conteudo={tipoAtual.descricao} rotulo="Ajuda sobre o tipo do arquivo" />
          </div>
          <select
            id="tipo-anexo-clinico"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setRequestDocumentId('');
              setErro(null);
            }}
            className="w-full rounded-[var(--r-sm)] border border-line-field bg-surface px-3 py-2.5 text-sm text-text focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          >
            {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}
          </select>
          <p className="cadencia-field-caption m-0">{tipoAtual.descricao}</p>
        </div>

        {kind === 'resultado_exame' ? (
          pedidosPendentes.length > 0 ? (
            <div className="grid gap-1.5 text-sm">
              <div className="flex items-center gap-2">
                <label htmlFor="pedido-exame-origem" className="font-semibold text-text">Pedido de exame correspondente</label>
                <span aria-hidden="true" className="cadencia-required-badge">Obrigatório</span>
                <InfoTip
                  conteudo="Escolha a solicitação que originou este resultado. Depois do envio, o pedido deixa a lista de pendências."
                  rotulo="Por que vincular o resultado"
                />
              </div>
              <select
                id="pedido-exame-origem"
                required
                value={requestDocumentId}
                onChange={(e) => {
                  setRequestDocumentId(e.target.value);
                  setErro(null);
                }}
                className="w-full rounded-[var(--r-sm)] border border-line-field bg-surface px-3 py-2.5 text-sm text-text focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
              >
                <option value="">Selecione o pedido…</option>
                {pedidosPendentes.map((pedido) => (
                  <option key={pedido.documentId} value={pedido.documentId}>
                    {pedido.titulo} · {dataCurta(pedido.issuedDate)}
                  </option>
                ))}
              </select>
              <p className="cadencia-field-caption m-0">
                {pedidosPendentes.length === 1
                  ? 'Há 1 pedido aguardando resultado.'
                  : `Há ${pedidosPendentes.length} pedidos aguardando resultado.`}
              </p>
            </div>
          ) : (
            <p className="rounded-xl border border-line bg-surface-subtle px-3 py-2.5 text-xs leading-relaxed text-text-muted">
              Não há pedido de exame pendente para este cidadão. O resultado pode ser anexado, mas ficará sem vínculo com uma solicitação específica.
            </p>
          )
        ) : null}

        <div className="grid gap-1.5 text-sm">
          <label htmlFor="arquivo-anexo-clinico" className="font-semibold text-text">Escolher arquivo</label>
          <input
            id="arquivo-anexo-clinico"
            type="file"
            disabled={enviando || (resultadoComPedidoObrigatorio && requestDocumentId === '')}
            onChange={(e) => { void escolher(e.target.files?.[0]); }}
            className="w-full rounded-lg border border-dashed border-line bg-surface-subtle p-2 text-sm text-text file:mr-3 file:rounded-[var(--r-sm)] file:border-0 file:bg-accent file:px-3 file:py-2 file:text-sm file:font-semibold file:text-accent-on disabled:cursor-not-allowed disabled:opacity-55"
          />
          <p className="cadencia-field-caption m-0">
            {resultadoComPedidoObrigatorio && requestDocumentId === ''
              ? 'Selecione o pedido acima para liberar o envio do resultado.'
              : 'PDFs e imagens podem ser visualizados no prontuário; outros formatos são baixados.'}
          </p>
        </div>

        {enviando ? <p role="status" className="text-sm text-text-muted">Enviando arquivo e registrando no prontuário…</p> : null}
        {erro !== null ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{erro}</p> : null}

        <section className="grid gap-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Arquivos no prontuário</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-text-faint">Clique em um arquivo para abrir ou baixar com acesso autenticado.</p>
          </div>
          {p.anexos.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line bg-surface-subtle px-3 py-5 text-center text-sm text-text-muted">
              Nenhum arquivo anexado a este cidadão ainda.
            </p>
          ) : (
            <ul className="grid gap-1">
              {p.anexos.map((a) => (
                <li key={a.attachmentId}>
                  <button
                    type="button"
                    disabled={abrindo === a.attachmentId}
                    onClick={() => {
                      setAbrindo(a.attachmentId);
                      void p.aoAbrir(a.attachmentId)
                        .catch(() => setErro('Não foi possível abrir o arquivo.'))
                        .finally(() => setAbrindo(null));
                    }}
                    className={cn(
                      'flex min-h-14 w-full items-center gap-2 rounded-xl border border-transparent px-2.5 py-2',
                      'text-left text-sm transition hover:border-line hover:bg-surface-hover',
                    )}
                  >
                    <Paperclip size={16} aria-hidden="true" className="shrink-0 text-text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-text">{a.originalName}</span>
                      <span className="block text-xs text-text-muted">
                        {ROTULO_KIND[a.kind] ?? a.kind} · {tamanho(a.sizeBytes)} · {dataCurta(a.criadoEm)}
                      </span>
                      {a.pedidoTitulo ? (
                        <span className="mt-0.5 block truncate text-[11px] font-medium text-accent">
                          Vinculado a: {a.pedidoTitulo}
                        </span>
                      ) : null}
                    </span>
                    <FileArrowDown size={16} aria-hidden="true" className="shrink-0 text-text-muted" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PainelLateral>
  );
}
