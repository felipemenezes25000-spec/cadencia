"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  TextB,
  TextItalic,
  TextHTwo,
  TextHThree,
  ListBullets,
  ListNumbers,
  Quotes,
  Check,
  SpinnerGap,
  Warning,
  FloppyDisk,
} from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { cn } from "../lib/cn";
import { Tooltip } from "../ui/Tooltip";
import { Icone } from "../ui/Icone";
import { Skeleton } from "../ui/Skeleton";
import { ATALHOS_DO_ATENDIMENTO } from "./atalhos";
import { SlashCommandExtension } from "./EditorSlashCommands";

/* ── tipos exportados (backward-compat) ──────────────────────────────── */

export interface CodigoHit {
  readonly code: string;
  readonly display: string;
}
export interface ModeloHit {
  readonly code: string;
  readonly texto: string;
}
export interface ValorAnterior {
  readonly valor: string;
  readonly em: string;
}

/* ── props ────────────────────────────────────────────────────────────── */

export interface EditorClinicoProps {
  readonly encounterId: string;
  readonly buscarCodigo: (termo: string) => Promise<CodigoHit[]>;
  readonly buscarModelo: (termo: string) => Promise<ModeloHit[]>;
  readonly buscarValorAnterior: (campo: string) => Promise<ValorAnterior | null>;
  readonly aoPrescrever: () => void;
  readonly aoPedirExame: () => void;
  readonly aoEmitirDocumento: () => void;
  readonly aoFinalizar: () => void;
  readonly aoCobrar?: () => void;
  /** Conteudo inicial em HTML ou JSON do TipTap */
  readonly conteudoInicial?: string;
  /** Callback de salvamento — recebe o JSON do editor */
  readonly onSalvar?: (conteudo: Record<string, unknown>) => Promise<void>;
  /** Modo somente leitura */
  readonly readOnly?: boolean;
}

/* ── mapa de atalhos clinicos ─────────────────────────────────────────── */

const MAPA_ATALHOS: Record<string, string> = {};
for (const a of ATALHOS_DO_ATENDIMENTO) {
  const partes = a.combinacao.split("+");
  const tecla = partes.at(-1)!.toLowerCase();
  MAPA_ATALHOS[tecla] = a.acao;
}

/* ── autosave status ──────────────────────────────────────────────────── */

type SaveStatus = "saved" | "saving" | "error" | "unsaved";

/* ── skeleton de carregamento ─────────────────────────────────────────── */

function EditorClinicoSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Carregando editor"
      data-testid="editor-clinico-skeleton"
      className="relative grid h-full grid-rows-[auto_1fr_auto] overflow-hidden rounded-[22px] border border-line/80 bg-surface/95 shadow-elev-2 backdrop-blur-xl"
    >
      {/* Toolbar skeleton */}
      <div className="relative border-b border-line/70/75 bg-surface/88 backdrop-blur-xl">
        <div className="flex min-h-11 items-center justify-between gap-3 px-3.5 py-2 sm:px-4">
          <Skeleton variant="text" width="120px" />
          <div className="hidden gap-1.5 sm:flex">
            <Skeleton variant="text" width="50px" height="20px" />
            <Skeleton variant="text" width="50px" height="20px" />
          </div>
        </div>
        <div className="flex items-center gap-1 border-t border-line px-2 py-1">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} variant="text" width="28px" height="28px" />
          ))}
        </div>
      </div>
      {/* Editor area skeleton */}
      <div className="p-[var(--s-6)] space-y-3">
        <Skeleton variant="text" width="40%" />
        <Skeleton variant="text" lines={4} />
      </div>
      {/* Status bar skeleton */}
      <div className="flex items-center justify-between border-t border-line px-[var(--s-4)] py-[var(--s-2)]">
        <Skeleton variant="text" width="80px" />
        <Skeleton variant="text" width="60px" />
      </div>
    </div>
  );
}

/* ── componente principal ─────────────────────────────────────────────── */

export function EditorClinico(p: EditorClinicoProps) {
  const {
    conteudoInicial,
    onSalvar,
    readOnly = false,
  } = p;

  const [segundos, setSegundos] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const intervalo = useRef<ReturnType<typeof setInterval> | null>(null);
  const docVersionRef = useRef(0);

  /* cronometro do atendimento */
  useEffect(() => {
    intervalo.current = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => {
      if (intervalo.current) clearInterval(intervalo.current);
    };
  }, []);

  const minutos = Math.floor(segundos / 60);
  const segs = segundos % 60;

  /* TipTap editor */
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        bulletList: {},
        orderedList: {},
        blockquote: {},
        bold: {},
        italic: {},
        code: {},
      }),
      Placeholder.configure({
        placeholder: "Comece a digitar o registro clinico...",
      }),
      SlashCommandExtension,
    ],
    content: conteudoInicial ?? "",
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm max-w-none",
          "font-doc text-text",
          "focus:outline-none",
          "min-h-[440px] px-5 py-6 sm:px-8 sm:py-8",
          "mx-auto w-full max-w-[860px]",
          "[&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-[-.025em] [&_h2]:text-text [&_h2]:mt-8 [&_h2]:mb-3",
          "[&_h3]:text-base [&_h3]:font-semibold [&_h3]:tracking-[-.015em] [&_h3]:text-text [&_h3]:mt-6 [&_h3]:mb-2",
          "[&_p]:text-[15px] [&_p]:leading-[1.78] [&_p]:text-text [&_p]:mb-3",
          "[&_ul]:list-disc [&_ul]:pl-5",
          "[&_ol]:list-decimal [&_ol]:pl-5",
          "[&_blockquote]:rounded-r-xl [&_blockquote]:border-l-[3px] [&_blockquote]:border-accent [&_blockquote]:bg-accent-soft/45 [&_blockquote]:px-4 [&_blockquote]:py-2 [&_blockquote]:italic",
          "[&_code]:rounded-[var(--r-sm)] [&_code]:bg-surface-raised [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs",
        ),
      },
    },
    onUpdate: () => {
      docVersionRef.current += 1;
    },
  });

  /* autosave com debounce de 2s */
  useEffect(() => {
    if (!editor || !onSalvar || readOnly) return;

    const version = docVersionRef.current;
    if (version === 0) return;

    setSaveStatus("unsaved");

    const timer = setTimeout(() => {
      setSaveStatus("saving");
      onSalvar(editor.getJSON() as Record<string, unknown>)
        .then(() => setSaveStatus("saved"))
        .catch(() => setSaveStatus("error"));
    }, 2000);

    return () => clearTimeout(timer);
  }, [editor?.state.doc, editor, onSalvar, readOnly]);

  /* atalhos clinicos (Ctrl+R, Ctrl+E, etc.) */
  const aoTeclar = useCallback(
    (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;

      const tecla = e.key.toLowerCase();
      const acao = MAPA_ATALHOS[tecla];
      if (acao === undefined) return;

      e.preventDefault();
      switch (acao) {
        case "prescrever":
          p.aoPrescrever();
          break;
        case "pedir_exame":
          p.aoPedirExame();
          break;
        case "emitir_documento":
          p.aoEmitirDocumento();
          break;
        case "cobrar":
          p.aoCobrar?.();
          break;
        case "finalizar":
          p.aoFinalizar();
          break;
      }
    },
    [p],
  );

  /* contagem de palavras */
  const textoPlano = editor?.getText() ?? "";
  const palavras = textoPlano.trim().split(/\s+/).filter(Boolean).length;

  if (!editor) {
    return <EditorClinicoSkeleton />;
  }

  return (
    <RadixTooltip.Provider delayDuration={300}>
    <div
      className="relative grid h-full grid-rows-[auto_1fr_auto] overflow-hidden rounded-[22px] border border-line/80 bg-surface/95 shadow-elev-2 backdrop-blur-xl"
      onKeyDown={aoTeclar}
    >
      {/* header: cronometro + atalhos + toolbar */}
      <div className="border-b border-line/70">
        {/* linha do cronometro e atalhos */}
        <div className="flex items-center justify-between px-[var(--s-4)] py-[var(--s-2)]">
          <span className="inline-flex items-center rounded-full border border-line/70 bg-surface-sunken/55 px-2.5 py-1 font-mono text-[10px] font-semibold tabular-nums text-text-muted">
            {`Duracao: ${String(minutos).padStart(2, "0")}:${String(segs).padStart(2, "0")}`}
          </span>
          <div className="flex gap-[var(--s-2)]">
            {ATALHOS_DO_ATENDIMENTO.slice(0, 4).map((a) => (
              <kbd
                key={a.acao}
                title={a.descricao}
                className="cadencia-command-key border-line/80 bg-surface-raised/75 text-[10px] text-text-faint"
              >
                {a.combinacao}
              </kbd>
            ))}
          </div>
        </div>

        {/* toolbar de formatacao */}
        {!readOnly && editor && <BarraDeFormatacao editor={editor} />}
      </div>

      {/* area do editor */}
      <div
        className="scrollbar-thin relative overflow-y-auto bg-[linear-gradient(180deg,color-mix(in_oklab,var(--surface)_98%,var(--accent-soft))_0%,var(--surface)_28%,var(--surface)_100%)]"
        role="article"
        aria-label="Editor clinico"
      >
        <EditorContent editor={editor} />
      </div>

      {/* barra de status */}
      <div className="flex min-h-10 items-center justify-between border-t border-line/70 bg-surface-sunken/35 px-4 py-2 print:hidden">
        <ContadorDePalavras palavras={palavras} />
        {onSalvar && <IndicadorAutoSave status={saveStatus} />}
      </div>
    </div>
    </RadixTooltip.Provider>
  );
}

/* ── toolbar de formatacao ────────────────────────────────────────────── */

function BarraDeFormatacao({ editor }: { readonly editor: Editor }) {
  return (
    <div
      className="scrollbar-thin flex items-center gap-1 overflow-x-auto border-t border-line/65 bg-surface-sunken/30 px-2.5 py-1.5 print:hidden"
      role="toolbar"
      aria-label="Formatacao de texto"
    >
      <BotaoDaToolbar
        icon={TextB}
        ativo={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        tooltip="Negrito (Ctrl+B)"
        ariaLabel="Negrito"
      />
      <BotaoDaToolbar
        icon={TextItalic}
        ativo={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        tooltip="Italico (Ctrl+I)"
        ariaLabel="Italico"
      />
      <SeparadorDaToolbar />
      <BotaoDaToolbar
        icon={TextHTwo}
        ativo={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        tooltip="Titulo (Ctrl+Shift+2)"
        ariaLabel="Titulo"
      />
      <BotaoDaToolbar
        icon={TextHThree}
        ativo={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        tooltip="Subtitulo (Ctrl+Shift+3)"
        ariaLabel="Subtitulo"
      />
      <SeparadorDaToolbar />
      <BotaoDaToolbar
        icon={ListBullets}
        ativo={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        tooltip="Lista (Ctrl+Shift+8)"
        ariaLabel="Lista com marcadores"
      />
      <BotaoDaToolbar
        icon={ListNumbers}
        ativo={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        tooltip="Lista numerada (Ctrl+Shift+7)"
        ariaLabel="Lista numerada"
      />
      <BotaoDaToolbar
        icon={Quotes}
        ativo={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        tooltip="Citacao (Ctrl+Shift+B)"
        ariaLabel="Citacao"
      />
    </div>
  );
}

function BotaoDaToolbar({
  icon,
  ativo,
  onClick,
  tooltip,
  ariaLabel,
}: {
  readonly icon: PhosphorIcon;
  readonly ativo: boolean;
  readonly onClick: () => void;
  readonly tooltip: string;
  readonly ariaLabel: string;
}) {
  return (
    <Tooltip conteudo={tooltip}>
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        aria-pressed={ativo}
        className={cn(
          "rounded-[var(--r-sm)] p-1.5 transition-colors-fast",
          ativo
            ? "bg-accent-soft text-accent"
            : "text-text-muted hover:bg-surface-hover hover:text-text",
        )}
      >
        <Icone icon={icon} size="sm" />
      </button>
    </Tooltip>
  );
}

function SeparadorDaToolbar() {
  return <div className="mx-1 h-4 w-px bg-line" aria-hidden="true" />;
}

/* ── indicador de autosave ────────────────────────────────────────────── */

function IndicadorAutoSave({ status }: { readonly status: SaveStatus }) {
  const configs: Record<SaveStatus, { icon: PhosphorIcon; texto: string; cor: string }> = {
    saved: { icon: Check, texto: "Salvo", cor: "text-ok" },
    saving: { icon: SpinnerGap, texto: "Salvando...", cor: "text-text-muted" },
    error: { icon: Warning, texto: "Erro ao salvar", cor: "text-danger" },
    unsaved: { icon: FloppyDisk, texto: "Nao salvo", cor: "text-warn" },
  };

  const cfg = configs[status];

  return (
    <span className={cn("flex items-center gap-1 text-[length:var(--fs-12)]", cfg.cor)} role="status">
      <Icone icon={cfg.icon} size="sm" className={status === "saving" ? "animate-spin" : ""} />
      {cfg.texto}
    </span>
  );
}

/* ── contador de palavras ─────────────────────────────────────────────── */

function ContadorDePalavras({ palavras }: { readonly palavras: number }) {
  return (
    <span className="text-[length:var(--fs-12)] text-text-muted">
      {palavras} {palavras === 1 ? "palavra" : "palavras"}
    </span>
  );
}
