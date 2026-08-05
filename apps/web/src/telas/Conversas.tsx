// apps/web/src/telas/Conversas.tsx
'use client';

import {
  CaixaDeConversas,
  type ConversaResumo,
  type FiltroConversas,
} from './CaixaDeConversas';
import {
  PainelDeConversa,
  type ContextoConversa,
  type Mensagem,
} from './PainelDeConversa';

export interface ConversasProps {
  readonly filtro: FiltroConversas;
  readonly conversaAbertaId: string | null;
  readonly carregarConversas: (filtro: FiltroConversas) => Promise<ConversaResumo[]>;
  readonly carregarMensagens: (conversationId: string) => Promise<Mensagem[]>;
  readonly carregarContexto: (conversationId: string) => Promise<ContextoConversa>;
  readonly aoMudarFiltro: (filtro: FiltroConversas) => void;
  readonly aoAbrirConversa: (conversationId: string) => void;
  readonly aoEnviar: (body: string) => Promise<{ messageId: string }>;
  readonly aoVincularPaciente: () => void;
  readonly aoSelecionarTemplate: () => void;
}

export function Conversas(p: ConversasProps) {
  const conversa = p.conversaAbertaId;

  if (conversa === null) {
    return (
      <div data-testid="split-view" style={{ gridTemplateColumns: '1fr' }}>
        <CaixaDeConversas
          filtro={p.filtro}
          carregar={p.carregarConversas}
          aoMudarFiltro={p.aoMudarFiltro}
          aoAbrirConversa={p.aoAbrirConversa}
        />
      </div>
    );
  }

  return (
    <div data-testid="split-view"
      style={{
        display: 'grid', gridTemplateColumns: '40% 60%',
        height: '100vh', overflow: 'hidden',
      }}>
      <div style={{ borderInlineEnd: 'var(--border)', overflowY: 'auto' }}>
        <CaixaDeConversas
          filtro={p.filtro}
          carregar={p.carregarConversas}
          aoMudarFiltro={p.aoMudarFiltro}
          aoAbrirConversa={p.aoAbrirConversa}
        />
      </div>
      <ConversaAbertaWrapper
        conversationId={conversa}
        carregarConversas={p.carregarConversas}
        filtro={p.filtro}
        carregarMensagens={p.carregarMensagens}
        carregarContexto={p.carregarContexto}
        aoEnviar={p.aoEnviar}
        aoVincularPaciente={p.aoVincularPaciente}
        aoSelecionarTemplate={p.aoSelecionarTemplate}
      />
    </div>
  );
}

interface WrapperProps {
  readonly conversationId: string;
  readonly filtro: FiltroConversas;
  readonly carregarConversas: (filtro: FiltroConversas) => Promise<ConversaResumo[]>;
  readonly carregarMensagens: (conversationId: string) => Promise<Mensagem[]>;
  readonly carregarContexto: (conversationId: string) => Promise<ContextoConversa>;
  readonly aoEnviar: (body: string) => Promise<{ messageId: string }>;
  readonly aoVincularPaciente: () => void;
  readonly aoSelecionarTemplate: () => void;
}

import { useEffect, useState } from 'react';

function ConversaAbertaWrapper(p: WrapperProps) {
  const [dados, setDados] = useState<ConversaResumo | null>(null);

  useEffect(() => {
    void p.carregarConversas(p.filtro).then((lista) => {
      const encontrada = lista.find((c) => c.conversationId === p.conversationId);
      setDados(encontrada ?? null);
    });
  }, [p, p.conversationId, p.filtro]);

  if (dados === null) return null;

  return (
    <PainelDeConversa
      conversationId={dados.conversationId}
      nomeExibido={dados.patientName ?? dados.phoneNumber}
      phoneNumber={dados.phoneNumber}
      patientId={dados.patientId}
      carregarMensagens={p.carregarMensagens}
      carregarContexto={p.carregarContexto}
      aoEnviar={p.aoEnviar}
      aoVincularPaciente={p.aoVincularPaciente}
      aoSelecionarTemplate={p.aoSelecionarTemplate}
    />
  );
}
