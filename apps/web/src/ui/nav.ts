import {
  House,
  Calendar,
  ChatCircle,
  Users,
  Wallet,
  ChartBar,
} from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

export interface ItemNav {
  readonly id: string;
  readonly rotulo: string;
  readonly href: string;
  readonly icone: PhosphorIcon;
  readonly atalho: string;
  readonly disponivelNaFase: 1 | 2 | 3;
  readonly motivo?: string;
}

export const ITENS_NAV: readonly ItemNav[] = [
  { id: "hoje",       rotulo: "Hoje",       href: "/hoje",       icone: House,      atalho: "1", disponivelNaFase: 1 },
  { id: "agenda",     rotulo: "Agenda",     href: "/agenda",     icone: Calendar,   atalho: "2", disponivelNaFase: 1 },
  { id: "conversas",  rotulo: "Conversas",  href: "/conversas",  icone: ChatCircle, atalho: "3", disponivelNaFase: 2 },
  { id: "pacientes",  rotulo: "Pacientes",  href: "/pacientes",  icone: Users,      atalho: "4", disponivelNaFase: 1 },
  { id: "financeiro", rotulo: "Financeiro", href: "/financeiro", icone: Wallet,     atalho: "5", disponivelNaFase: 2 },
  { id: "desempenho", rotulo: "Desempenho", href: "/desempenho", icone: ChartBar,   atalho: "6", disponivelNaFase: 3,
    motivo: "Desempenho e atribuicao de variacao chegam na Fase 3" },
];

export const FASE_ATUAL = 5 as const;
