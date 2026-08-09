"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { Extension } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import type { Editor, Range } from "@tiptap/react";
import type { SuggestionOptions } from "@tiptap/suggestion";
import {
  ChatCircle,
  Heartbeat,
  Brain,
  ListChecks,
  Pill,
  TestTube,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { cn } from "../lib/cn";
import { Icone } from "../ui/Icone";

/* ── tipos ────────────────────────────────────────────────────────────── */

export interface SlashCommand {
  readonly id: string;
  readonly titulo: string;
  readonly descricao: string;
  readonly icone: PhosphorIcon;
  readonly secao: "SOAP" | "Acoes" | "Codigos";
}

/* ── lista de comandos ────────────────────────────────────────────────── */

export const SLASH_COMMANDS: SlashCommand[] = [
  // SOAP sections
  {
    id: "subjetivo",
    titulo: "Subjetivo",
    descricao: "Queixa e historia do paciente",
    icone: ChatCircle,
    secao: "SOAP",
  },
  {
    id: "objetivo",
    titulo: "Objetivo",
    descricao: "Exame fisico e sinais vitais",
    icone: Heartbeat,
    secao: "SOAP",
  },
  {
    id: "avaliacao",
    titulo: "Avaliacao",
    descricao: "Hipotese diagnostica",
    icone: Brain,
    secao: "SOAP",
  },
  {
    id: "plano",
    titulo: "Plano",
    descricao: "Conduta terapeutica",
    icone: ListChecks,
    secao: "SOAP",
  },

  // Actions
  {
    id: "prescricao",
    titulo: "Prescricao",
    descricao: "Inserir prescricao medica",
    icone: Pill,
    secao: "Acoes",
  },
  {
    id: "exame",
    titulo: "Exame",
    descricao: "Solicitar exame complementar",
    icone: TestTube,
    secao: "Acoes",
  },

  // Code lookups
  {
    id: "cid",
    titulo: "CID",
    descricao: "Buscar codigo CID-10",
    icone: MagnifyingGlass,
    secao: "Codigos",
  },
];

/* ── agrupar por secao ────────────────────────────────────────────────── */

export function agruparPorSecao(
  items: SlashCommand[],
): Record<string, SlashCommand[]> {
  const grupos: Record<string, SlashCommand[]> = {};
  for (const item of items) {
    const secao = item.secao;
    if (!grupos[secao]) {
      grupos[secao] = [];
    }
    grupos[secao]!.push(item);
  }
  return grupos;
}

/* ── inserir secao no editor ──────────────────────────────────────────── */

export function insertarSecao(editor: Editor, id: string): void {
  switch (id) {
    case "subjetivo":
      editor
        .chain()
        .focus()
        .insertContent([
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Subjetivo" }],
          },
          { type: "paragraph" },
        ])
        .run();
      break;
    case "objetivo":
      editor
        .chain()
        .focus()
        .insertContent([
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Objetivo" }],
          },
          { type: "paragraph" },
        ])
        .run();
      break;
    case "avaliacao":
      editor
        .chain()
        .focus()
        .insertContent([
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Avaliacao" }],
          },
          { type: "paragraph" },
        ])
        .run();
      break;
    case "plano":
      editor
        .chain()
        .focus()
        .insertContent([
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Plano" }],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph" }],
              },
            ],
          },
        ])
        .run();
      break;
    case "prescricao":
      editor
        .chain()
        .focus()
        .insertContent([
          {
            type: "heading",
            attrs: { level: 3 },
            content: [{ type: "text", text: "Prescricao" }],
          },
          {
            type: "orderedList",
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph" }],
              },
            ],
          },
        ])
        .run();
      break;
    case "exame":
      editor
        .chain()
        .focus()
        .insertContent([
          {
            type: "heading",
            attrs: { level: 3 },
            content: [{ type: "text", text: "Exames solicitados" }],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph" }],
              },
            ],
          },
        ])
        .run();
      break;
    case "cid":
      editor.chain().focus().insertContent("CID: ").run();
      break;
  }
}

/* ── componente popup do menu de slash ─────────────────────────────────── */

export interface SlashMenuProps {
  readonly items: SlashCommand[];
  readonly command: (item: SlashCommand) => void;
}

export interface SlashMenuRef {
  onKeyDown: (args: { event: KeyboardEvent }) => boolean;
}

export const SlashMenu = forwardRef<SlashMenuRef, SlashMenuProps>(
  function SlashMenu({ items, command }, ref) {
    const [indiceAtivo, setIndiceAtivo] = useState(0);

    const grupos = agruparPorSecao(items);

    useEffect(() => setIndiceAtivo(0), [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === "ArrowUp") {
          setIndiceAtivo((i) => (i > 0 ? i - 1 : items.length - 1));
          return true;
        }
        if (event.key === "ArrowDown") {
          setIndiceAtivo((i) => (i < items.length - 1 ? i + 1 : 0));
          return true;
        }
        if (event.key === "Enter") {
          if (items[indiceAtivo]) {
            command(items[indiceAtivo]);
          }
          return true;
        }
        if (event.key === "Escape") {
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div
          className={cn(
            "z-[var(--z-popover)] w-[min(340px,calc(100vw-24px))] rounded-2xl",
            "border border-line/80 bg-surface/95 shadow-[var(--elev-float)] backdrop-blur-xl",
            "overflow-hidden ring-1 ring-white/50",
          )}
          role="listbox"
          aria-label="Comandos de barra"
        >
          <div className="px-[var(--s-5)] py-[var(--s-4)] text-[length:var(--fs-13)] text-text-muted">
            Nenhum comando encontrado
          </div>
        </div>
      );
    }

    return (
      <div
        className={cn(
          "z-[var(--z-popover)] w-[min(340px,calc(100vw-24px))] rounded-2xl",
          "border border-line/80 bg-surface/95 shadow-[var(--elev-float)] backdrop-blur-xl",
          "overflow-hidden ring-1 ring-white/50",
        )}
        role="listbox"
        aria-label="Comandos de barra"
      >
        {Object.entries(grupos).map(([secao, cmds]) => (
          <div key={secao}>
            <div
              className={cn(
                "border-t border-line/50 px-4 pb-1.5 pt-3 first:border-t-0",
                "text-[9px] font-bold uppercase tracking-[.11em]",
                "text-text-faint",
              )}
              aria-hidden="true"
            >
              {secao}
            </div>
            {cmds.map((item) => {
              const flatIndex = items.indexOf(item);
              const ativo = flatIndex === indiceAtivo;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={ativo}
                  onClick={() => command(item)}
                  className={cn(
                    "mx-1.5 mb-1 flex w-[calc(100%-12px)] items-center gap-3 rounded-xl px-3 py-2.5",
                    "text-left transition-all duration-150",
                    ativo
                      ? "bg-accent-soft text-text shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--accent),transparent_78%)]"
                      : "text-text hover:bg-surface-raised",
                  )}
                >
                  <Icone
                    icon={item.icone}
                    size="md"
                    className={ativo ? "text-accent" : "text-text-muted"}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[length:var(--fs-14)] font-[var(--fw-medium)] leading-[var(--lh-ui)]">
                      {item.titulo}
                    </p>
                    <p
                      className={cn(
                        "text-[length:var(--fs-12)] leading-[var(--lh-ui)]",
                        ativo ? "text-accent/80" : "text-text-muted",
                      )}
                    >
                      {item.descricao}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    );
  },
);

/* ── extensao TipTap ──────────────────────────────────────────────────── */

export const SlashCommandExtension = Extension.create({
  name: "slashCommand",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        startOfLine: false,
        items: ({ query }: { query: string }) => {
          return SLASH_COMMANDS.filter((cmd) =>
            cmd.titulo.toLowerCase().includes(query.toLowerCase()),
          );
        },
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: Range;
          props: SlashCommand;
        }) => {
          editor.chain().focus().deleteRange(range).run();
          insertarSecao(editor, props.id);
        },
      } satisfies Partial<SuggestionOptions<SlashCommand>>,
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
