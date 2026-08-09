'use client';

import { useEffect, useMemo, useState } from 'react';
import { CaretLeft, CaretRight, Plus } from '@phosphor-icons/react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { VISOES, faixasDoDia, type Visao } from './grade';
import type { LinhaDaFila } from './Hoje';
import type { StatusAgenda } from '../ui/ChipDeStatus';
import { Botao } from '../ui/Botao';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/Tabs';
import { PageHeader } from '../ui/PageHeader';
import { Skeleton } from '../ui/Skeleton';
import { AgendaDragContext } from './AgendaDragContext';
import { cn } from '../lib/cn';

export interface AgendaProps {
  readonly dia: string;
  readonly visao: Visao['chave'];
  readonly timezone: string;
  readonly carregar: (dia: string) => Promise<LinhaDaFila[]>;
  readonly aoMudarVisao: (v: Visao['chave']) => void;
  readonly aoMudarDia: (dia: string) => void;
  readonly aoAbrirCompositor: (inicioMin: number) => void;
  readonly aoMover: (appointmentId: string, novoInicioIso: string) => Promise<void>;
  readonly aoConfirmar: (appointmentId: string) => Promise<void>;
  readonly aoCobrar: (appointmentId: string) => void;
}

/* ── Constantes ─────────────────────────────────────────── */

const INICIO_HORA = 7;
const FIM_HORA = 20;
const INICIO_MIN = INICIO_HORA * 60;
const FIM_MIN = FIM_HORA * 60;
const PASSO_MIN = 15;
const PX_POR_HORA = 64;

const HORAS = Array.from(
  { length: FIM_HORA - INICIO_HORA },
  (_, i) => `${String(INICIO_HORA + i).padStart(2, '0')}:00`,
);

const FAIXAS = faixasDoDia({ inicioMin: INICIO_MIN, fimMin: FIM_MIN, passoMin: PASSO_MIN });

const NOMES_DIAS_CURTO = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];

const ROTULOS_NAV: Record<Visao['chave'], { anterior: string; proximo: string }> = {
  dia:           { anterior: 'Dia anterior',     proximo: 'Proximo dia' },
  semana:        { anterior: 'Semana anterior',  proximo: 'Proxima semana' },
  mes:           { anterior: 'Mes anterior',     proximo: 'Proximo mes' },
  profissional:  { anterior: 'Dia anterior',     proximo: 'Proximo dia' },
  sala:          { anterior: 'Dia anterior',     proximo: 'Proximo dia' },
};

/* ── Cores de status ──────────────────────────────────────── */

const coresDeStatus: Record<StatusAgenda, string> = {
  agendado:       'bg-surface border-l-st-agendado text-text',
  confirmado:     'bg-ok/10 border-l-st-confirmado text-st-confirmado',
  aguardando:     'bg-warn/10 border-l-st-aguardando text-st-aguardando',
  atendendo:      'bg-accent/10 border-l-st-atendendo text-st-atendendo',
  em_atendimento: 'bg-accent/10 border-l-st-atendendo text-st-atendendo',
  atendido:       'bg-ok/10 border-l-st-atendido text-text-muted',
  faltou:         'bg-danger/10 border-l-st-faltou text-st-faltou',
  cancelado:      'bg-surface-sunken border-l-st-cancelado text-text-faint line-through',
  pendente:       'bg-warn/10 border-l-st-aguardando text-st-aguardando',
  pago:           'bg-ok/10 border-l-st-atendido text-text-muted',
  vencido:        'bg-danger/10 border-l-st-faltou text-st-faltou',
};

/* ── Utilitarios de data ──────────────────────────────────── */

function adicionarDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + dias)).toISOString().slice(0, 10);
}

function adicionarMeses(iso: string, meses: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1 + meses, d!)).toISOString().slice(0, 10);
}

function formatarData(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('pt-BR', {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function inicioSemana(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return adicionarDias(iso, dow === 0 ? -6 : 1 - dow);
}

function diasDoMes(iso: string): { dia: string; doMes: boolean }[] {
  const [ano, mes] = iso.split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(ano!, mes!, 0)).getUTCDate();
  const primeiroDow = new Date(Date.UTC(ano!, mes! - 1, 1)).getUTCDay();
  const offset = primeiroDow === 0 ? 6 : primeiroDow - 1;

  const resultado: { dia: string; doMes: boolean }[] = [];
  for (let i = offset; i > 0; i--) {
    resultado.push({
      dia: new Date(Date.UTC(ano!, mes! - 1, 1 - i)).toISOString().slice(0, 10),
      doMes: false,
    });
  }
  for (let i = 1; i <= ultimoDia; i++) {
    resultado.push({
      dia: new Date(Date.UTC(ano!, mes! - 1, i)).toISOString().slice(0, 10),
      doMes: true,
    });
  }
  while (resultado.length % 7 !== 0 || resultado.length < 35) {
    const next = resultado.length - offset - ultimoDia + 1;
    resultado.push({
      dia: new Date(Date.UTC(ano!, mes!, next)).toISOString().slice(0, 10),
      doMes: false,
    });
  }
  return resultado;
}

/* ── Calculo de posicao na grade temporal ──────────────────── */

function minutosLocais(iso: string, timezone: string): number {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
  });
  const [h, m] = fmt.format(Date.parse(iso)).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function calcularPosicao(startsAt: string, endsAt: string, timezone: string) {
  const inicio = minutosLocais(startsAt, timezone);
  const fim = minutosLocais(endsAt, timezone);
  const top = ((inicio - INICIO_MIN) / 60) * PX_POR_HORA;
  const height = Math.max(((fim - inicio) / 60) * PX_POR_HORA, PX_POR_HORA / 4);
  return { top, height };
}

function formatarHorario(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
  }).format(Date.parse(iso));
}

/* ── AgendaSkeleton ─────────────────────────────────────── */

function AgendaSkeleton() {
  return (
    <div className="space-y-4 pt-4" data-testid="agenda-skeleton">
      <Skeleton variant="text" width="200px" />
      <Skeleton variant="text" width="400px" height="40px" />
      <div className="grid grid-cols-[60px_1fr] gap-0">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="col-span-2">
            <Skeleton variant="table-row" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── BlocoDeAgendamento ─────────────────────────────────── */

function BlocoDeAgendamento({
  item, timezone, confirmando, aoConfirmar, aoCobrar,
}: {
  readonly item: LinhaDaFila;
  readonly timezone: string;
  readonly confirmando: string | null;
  readonly aoConfirmar: (id: string) => void;
  readonly aoCobrar: (id: string) => void;
}) {
  const { top, height } = calcularPosicao(item.startsAt, item.endsAt, timezone);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.appointmentId,
    data: { agendamento: item },
  });

  // Desestruturar attributes para evitar role="button" que causa nested-interactive
  // quando o bloco contem botoes internos (Confirmar, Cobrar).
  const { role: _role, ...dragAttrs } = attributes;

  return (
    <div
      ref={setNodeRef}
      data-status={item.status}
      aria-roledescription="item arrastavel"
      aria-describedby="dnd-instrucoes"
      className={cn(
        'absolute left-1 right-1 rounded-[var(--r-sm)] text-xs',
        'border-l-[3px] overflow-hidden',
        'transition-shadow duration-150 hover:shadow-elev-1',
        coresDeStatus[item.status],
        isDragging && 'opacity-30',
      )}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
        ...(item.procedureCor ? { borderLeftColor: item.procedureCor } : {}),
        ...(item.encaixe ? {
          background: 'repeating-linear-gradient(45deg, var(--surface) 0 6px, var(--surface-sunken) 6px 12px)',
        } : {}),
      }}
    >
      <div className="flex items-center justify-between h-full min-w-0">
        {/* Area arrastavel: recebe listeners e atributos do dnd-kit */}
        <span
          {...listeners}
          {...dragAttrs}
          className="overflow-hidden text-ellipsis whitespace-nowrap min-w-0 flex-1 cursor-grab active:cursor-grabbing px-2 py-1"
        >
          {item.displayName}
          {item.status === 'confirmado' && (
            <span
              aria-label="Confirmado"
              className="ml-[var(--s-2)] text-st-confirmado text-[var(--fs-11)]"
            >
              ✓
            </span>
          )}
        </span>
        <span className="flex gap-[var(--s-2)] shrink-0 pr-1">
          {item.status === 'agendado' && (
            <Botao
              variante="fantasma" tamanho="sm"
              carregando={confirmando === item.appointmentId}
              aria-label={`Confirmar ${item.displayName}`}
              onClick={(e) => { e.stopPropagation(); aoConfirmar(item.appointmentId); }}
            >
              Confirmar
            </Botao>
          )}
          {item.pagamentoPendente && (
            <Botao
              variante="fantasma" tamanho="sm"
              aria-label={`Cobrar ${item.displayName}`}
              onClick={(e) => { e.stopPropagation(); aoCobrar(item.appointmentId); }}
            >
              Cobrar
            </Botao>
          )}
        </span>
      </div>
    </div>
  );
}

/* ── SlotDeHorario (drop target de 15 minutos) ──────────── */

function SlotDeHorario({
  horario,
  colIdx,
  slotIdx,
  aoAbrirCompositor,
}: {
  readonly horario: string;
  readonly colIdx: number;
  readonly slotIdx: number;
  readonly aoAbrirCompositor: (inicioMin: number) => void;
}) {
  const droppableId = `slot-${colIdx}-${horario}`;
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });

  return (
    <div
      ref={setNodeRef}
      data-slot="vazio"
      data-horario={horario}
      className={cn(
        'absolute left-0 right-0 cursor-pointer transition-colors duration-100',
        isOver
          ? 'border-b-2 border-dashed border-[var(--accent)] bg-[var(--accent)]/5'
          : 'hover:bg-accent/5',
      )}
      style={{
        top: `${(slotIdx * PASSO_MIN / 60) * PX_POR_HORA}px`,
        height: `${(PASSO_MIN / 60) * PX_POR_HORA}px`,
      }}
      onClick={() => aoAbrirCompositor(INICIO_MIN + slotIdx * PASSO_MIN)}
    />
  );
}

/* ── GradeDeHorarios (grade temporal reutilizavel) ────────── */

function GradeDeHorarios({
  itensPorColuna, cabecalhos, timezone, confirmando,
  aoConfirmar, aoCobrar, aoAbrirCompositor, ariaLabel,
}: {
  readonly itensPorColuna: LinhaDaFila[][];
  readonly cabecalhos?: string[];
  readonly timezone: string;
  readonly confirmando: string | null;
  readonly aoConfirmar: (id: string) => void;
  readonly aoCobrar: (id: string) => void;
  readonly aoAbrirCompositor: (inicioMin: number) => void;
  readonly ariaLabel?: string;
}) {
  const colunas = itensPorColuna.length;
  const alturaTotal = (FIM_HORA - INICIO_HORA) * PX_POR_HORA;

  return (
    <div
      aria-label={ariaLabel}
      className="overflow-y-auto overflow-x-auto rounded-xl border border-line bg-surface shadow-elev-1"
      style={{ maxHeight: 'calc(100vh - 260px)' }}
    >
      {cabecalhos && (
        <div
          className="grid sticky top-0 z-10 bg-surface border-b border-line"
          style={{ gridTemplateColumns: `60px repeat(${colunas}, minmax(120px, 1fr))` }}
        >
          <div className="border-r border-line" />
          {cabecalhos.map((c) => (
            <div
              key={c}
              className="py-2 px-2 text-xs font-medium text-text-muted text-center border-r border-line last:border-r-0"
            >
              {c}
            </div>
          ))}
        </div>
      )}

      <div
        className="grid"
        style={{ gridTemplateColumns: `60px repeat(${colunas}, minmax(120px, 1fr))` }}
      >
        {/* Coluna de horarios */}
        <div className="relative" style={{ height: `${alturaTotal}px` }}>
          {HORAS.map((h, i) => (
            <div
              key={h}
              className="absolute right-0 pr-2 text-right border-b border-line"
              style={{ top: `${i * PX_POR_HORA}px`, height: `${PX_POR_HORA}px` }}
            >
              <span className="text-xs text-text-faint font-mono leading-none">{h}</span>
            </div>
          ))}
        </div>

        {/* Colunas de agendamentos */}
        {itensPorColuna.map((itensColuna, colIdx) => (
          <div
            key={colIdx}
            className="relative border-l border-line"
            style={{ height: `${alturaTotal}px` }}
          >
            {/* Linhas de hora */}
            {HORAS.map((h, i) => (
              <div
                key={h}
                className="absolute left-0 right-0 border-b border-line"
                style={{ top: `${i * PX_POR_HORA}px`, height: `${PX_POR_HORA}px` }}
              />
            ))}

            {/* Slots clicaveis de 15 minutos (droppable) */}
            {FAIXAS.map((f, i) => (
              <SlotDeHorario
                key={`c-${f}`}
                horario={f}
                colIdx={colIdx}
                slotIdx={i}
                aoAbrirCompositor={aoAbrirCompositor}
              />
            ))}

            {/* Blocos de agendamento */}
            {itensColuna.map((it) => (
              <BlocoDeAgendamento
                key={it.appointmentId}
                item={it} timezone={timezone} confirmando={confirmando}
                aoConfirmar={aoConfirmar} aoCobrar={aoCobrar}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── ListaDeAgendamentos (visualizacao mobile) ────────────── */

function ListaDeAgendamentos({
  itens, timezone, confirmando, aoConfirmar, aoCobrar,
}: {
  readonly itens: LinhaDaFila[];
  readonly timezone: string;
  readonly confirmando: string | null;
  readonly aoConfirmar: (id: string) => void;
  readonly aoCobrar: (id: string) => void;
}) {
  const ordenados = useMemo(
    () => [...itens].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [itens],
  );

  if (ordenados.length === 0) {
    return (
      <div className="py-12 text-center text-text-muted text-sm">
        Nenhum agendamento para este dia.
      </div>
    );
  }

  return (
    <div className="divide-y divide-line rounded-xl border border-line bg-surface shadow-elev-1">
      {ordenados.map((it) => (
        <div
          key={it.appointmentId}
          data-status={it.status}
          className={cn(
            'flex items-center gap-3 px-4 py-3 border-l-[3px]',
            coresDeStatus[it.status],
          )}
          style={it.procedureCor ? { borderLeftColor: it.procedureCor } : undefined}
        >
          <span className="text-xs font-mono text-text-muted w-12 shrink-0">
            {formatarHorario(it.startsAt, timezone)}
          </span>
          <span className="flex-1 min-w-0">
            <span className="text-sm font-medium truncate block">
              {it.displayName}
              {it.status === 'confirmado' && (
                <span aria-label="Confirmado" className="ml-1 text-st-confirmado text-[11px]">
                  ✓
                </span>
              )}
            </span>
            {it.procedureNome && (
              <span className="text-xs text-text-muted truncate block">{it.procedureNome}</span>
            )}
          </span>
          <span className="flex gap-1 shrink-0">
            {it.status === 'agendado' && (
              <Botao variante="fantasma" tamanho="sm"
                carregando={confirmando === it.appointmentId}
                aria-label={`Confirmar ${it.displayName}`}
                onClick={() => aoConfirmar(it.appointmentId)}>
                Confirmar
              </Botao>
            )}
            {it.pagamentoPendente && (
              <Botao variante="fantasma" tamanho="sm"
                aria-label={`Cobrar ${it.displayName}`}
                onClick={() => aoCobrar(it.appointmentId)}>
                Cobrar
              </Botao>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── GradeMes (visualizacao de calendario mensal) ─────────── */

function GradeMes({
  dia, itens, aoMudarDia, aoMudarVisao,
}: {
  readonly dia: string;
  readonly itens: LinhaDaFila[];
  readonly aoMudarDia: (d: string) => void;
  readonly aoMudarVisao: (v: Visao['chave']) => void;
}) {
  const dias = useMemo(() => diasDoMes(dia), [dia]);
  const hj = hojeISO();

  const contagem = useMemo(() => {
    const map: Record<string, number> = {};
    for (const it of itens) {
      const d = it.startsAt.slice(0, 10);
      map[d] = (map[d] ?? 0) + 1;
    }
    return map;
  }, [itens]);

  return (
    <div
      className="overflow-hidden rounded-xl border border-line bg-surface shadow-elev-1"
      role="grid"
      aria-label="Calendario mensal"
    >
      <div className="grid grid-cols-7 border-b border-line" role="row">
        {NOMES_DIAS_CURTO.map((d) => (
          <div key={d} role="columnheader" className="py-2 text-center text-xs font-medium text-text-muted">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {dias.map(({ dia: d, doMes }) => {
          const diaNum = parseInt(d.slice(8, 10), 10);
          const ehHoje = d === hj;
          const ehSelecionado = d === dia;
          const count = contagem[d] ?? 0;

          return (
            <button
              key={d} type="button" role="gridcell"
              onClick={() => { aoMudarDia(d); aoMudarVisao('dia'); }}
              className={cn(
                'h-20 p-1 text-sm border-b border-r border-line text-left',
                'hover:bg-surface-hover transition-colors duration-100 cursor-pointer',
                'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
                'outline-none',
                !doMes && 'text-text-faint',
                doMes && 'text-text',
                ehSelecionado && 'bg-accent-soft',
              )}
            >
              <span className={cn(
                'inline-flex items-center justify-center w-6 h-6 rounded-full text-xs',
                ehHoje && 'bg-accent text-accent-on font-semibold',
              )}>
                {diaNum}
              </span>
              {count > 0 && (
                <div className="flex gap-0.5 mt-1">
                  {Array.from({ length: Math.min(count, 4) }).map((_, i) => (
                    <span key={i} className="w-1.5 h-1.5 rounded-full bg-accent" aria-hidden />
                  ))}
                  {count > 4 && (
                    <span className="text-[9px] text-text-muted">+{count - 4}</span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Componente principal ───────────────────────────────── */

export function Agenda(p: AgendaProps) {
  const [itens, setItens] = useState<LinhaDaFila[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [confirmando, setConfirmando] = useState<string | null>(null);

  /* Carregar dados */
  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    void p.carregar(p.dia).then((dados) => {
      if (!cancelado) {
        setItens(dados);
        setCarregando(false);
      }
    });
    return () => { cancelado = true; };
  }, [p, p.dia]);

  /* Atalhos de teclado (1-5 para trocar visao) */
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent): void {
      const alvo = e.target as HTMLElement | null;
      const editando = alvo?.tagName === 'INPUT' || alvo?.tagName === 'TEXTAREA'
        || alvo?.isContentEditable === true;
      if (editando || e.metaKey || e.ctrlKey || e.altKey) return;
      const v = VISOES.find((x) => x.atalho === e.key);
      if (v !== undefined) { e.preventDefault(); p.aoMudarVisao(v.chave); }
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [p]);

  /* Confirmar agendamento */
  async function confirmar(appointmentId: string): Promise<void> {
    setConfirmando(appointmentId);
    try {
      await p.aoConfirmar(appointmentId);
      setItens((atual) => atual.map((it) =>
        it.appointmentId === appointmentId
          ? { ...it, status: 'confirmado' as const }
          : it));
    } finally {
      setConfirmando(null);
    }
  }

  /* Mover agendamento via drag-and-drop */
  function moverAgendamento(agendamentoId: string, novoSlotId: string): void {
    // O novoSlotId tem o formato "slot-{colIdx}-{horario}" onde horario e "HH:MM"
    const parts = novoSlotId.split('-');
    const horario = parts.slice(2).join('-'); // "HH:MM" (rejoin in case of unexpected dashes)
    if (horario) {
      void p.aoMover(agendamentoId, horario);
    }
  }

  /* Navegacao de data */
  function navAnterior(): void {
    if (p.visao === 'mes') p.aoMudarDia(adicionarMeses(p.dia, -1));
    else if (p.visao === 'semana') p.aoMudarDia(adicionarDias(p.dia, -7));
    else p.aoMudarDia(adicionarDias(p.dia, -1));
  }

  function navProximo(): void {
    if (p.visao === 'mes') p.aoMudarDia(adicionarMeses(p.dia, 1));
    else if (p.visao === 'semana') p.aoMudarDia(adicionarDias(p.dia, 7));
    else p.aoMudarDia(adicionarDias(p.dia, 1));
  }

  /* Itens agrupados para semana */
  const semanaItens = useMemo(() => {
    if (p.visao !== 'semana') return [[]];
    const seg = inicioSemana(p.dia);
    const dias = Array.from({ length: 7 }, (_, i) => adicionarDias(seg, i));
    return dias.map((d) => itens.filter((it) => it.startsAt.slice(0, 10) === d));
  }, [p.visao, p.dia, itens]);

  const semanaCabecalhos = useMemo(() => {
    if (p.visao !== 'semana') return [];
    const seg = inicioSemana(p.dia);
    return Array.from({ length: 7 }, (_, i) => {
      const d = adicionarDias(seg, i);
      const dd = parseInt(d.slice(8, 10), 10);
      return `${NOMES_DIAS_CURTO[i]} ${dd}`;
    });
  }, [p.visao, p.dia]);

  /* Itens agrupados por profissional */
  const { profItens, profCabecalhos } = useMemo(() => {
    if (p.visao !== 'profissional') return { profItens: [[]] as LinhaDaFila[][], profCabecalhos: [] as string[] };
    const ids = [...new Set(itens.map((it) => it.professionalId))];
    if (ids.length === 0) return { profItens: [[]] as LinhaDaFila[][], profCabecalhos: ['Profissional'] };
    return {
      profItens: ids.map((id) => itens.filter((it) => it.professionalId === id)),
      profCabecalhos: ids,
    };
  }, [p.visao, itens]);

  /* Itens para sala (sem dados de sala, coluna unica) */
  const salaItens = useMemo(() => [itens], [itens]);

  const rotulos = ROTULOS_NAV[p.visao];

  const acoes = (
    <div className="flex items-center gap-2 flex-wrap">
      <Botao variante="secundario" tamanho="sm" aria-label={rotulos.anterior} onClick={navAnterior}>
        <CaretLeft size={14} aria-hidden />
      </Botao>
      <Botao variante="secundario" tamanho="sm" onClick={() => p.aoMudarDia(hojeISO())}>
        Hoje
      </Botao>
      <Botao variante="secundario" tamanho="sm" aria-label={rotulos.proximo} onClick={navProximo}>
        <CaretRight size={14} aria-hidden />
      </Botao>
      <span className="text-sm text-text-muted hidden sm:inline ml-1">
        {formatarData(p.dia)}
      </span>
      <Botao iconeEsquerda={Plus} tamanho="sm" onClick={() => p.aoAbrirCompositor(INICIO_MIN)}>
        Novo
      </Botao>
    </div>
  );

  const gradeProps = {
    timezone: p.timezone,
    confirmando,
    aoConfirmar: confirmar,
    aoCobrar: p.aoCobrar,
    aoAbrirCompositor: p.aoAbrirCompositor,
  };

  return (
    <div className="cadencia-page grid gap-6">
      <PageHeader titulo="Agenda" acoes={acoes} semBreadcrumb />

      <Tabs value={p.visao} onValueChange={(v) => p.aoMudarVisao(v as Visao['chave'])}>
        <TabsList className="overflow-x-auto">
          {VISOES.map((v) => (
            <TabsTrigger key={v.chave} value={v.chave}>{v.rotulo}</TabsTrigger>
          ))}
        </TabsList>

        {carregando ? (
          <AgendaSkeleton />
        ) : (
          <>
            <TabsContent value="dia">
              {/* Desktop: grade de horarios com DnD */}
              <div className="hidden md:block" data-view="desktop-grid">
                <AgendaDragContext
                  onMover={moverAgendamento}
                  agendamentos={itens}
                  timezone={p.timezone}
                >
                  <GradeDeHorarios
                    itensPorColuna={[itens]}
                    ariaLabel={`Agenda de ${p.dia}`}
                    {...gradeProps}
                  />
                </AgendaDragContext>
              </div>
              {/* Mobile: lista cronologica */}
              <div className="md:hidden" data-view="mobile-list">
                <ListaDeAgendamentos
                  itens={itens} timezone={p.timezone} confirmando={confirmando}
                  aoConfirmar={confirmar} aoCobrar={p.aoCobrar}
                />
              </div>
            </TabsContent>

            <TabsContent value="semana">
              <div className="overflow-x-auto">
                <AgendaDragContext
                  onMover={moverAgendamento}
                  agendamentos={itens}
                  timezone={p.timezone}
                >
                  <GradeDeHorarios
                    itensPorColuna={semanaItens}
                    cabecalhos={semanaCabecalhos}
                    ariaLabel={`Agenda da semana de ${p.dia}`}
                    {...gradeProps}
                  />
                </AgendaDragContext>
              </div>
            </TabsContent>

            <TabsContent value="mes">
              <GradeMes
                dia={p.dia} itens={itens}
                aoMudarDia={p.aoMudarDia} aoMudarVisao={p.aoMudarVisao}
              />
            </TabsContent>

            <TabsContent value="profissional">
              <AgendaDragContext
                onMover={moverAgendamento}
                agendamentos={itens}
                timezone={p.timezone}
              >
                <GradeDeHorarios
                  itensPorColuna={profItens}
                  cabecalhos={profCabecalhos}
                  ariaLabel="Agenda por profissional"
                  {...gradeProps}
                />
              </AgendaDragContext>
            </TabsContent>

            <TabsContent value="sala">
              <AgendaDragContext
                onMover={moverAgendamento}
                agendamentos={itens}
                timezone={p.timezone}
              >
                <GradeDeHorarios
                  itensPorColuna={salaItens}
                  cabecalhos={['Sala']}
                  ariaLabel="Agenda por sala"
                  {...gradeProps}
                />
              </AgendaDragContext>
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
