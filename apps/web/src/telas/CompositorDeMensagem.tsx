// apps/web/src/telas/CompositorDeMensagem.tsx
'use client';

import { useState } from 'react';
import { Botao } from '../ui/Botao';

export interface TemplateMensagem {
  readonly templateId: string;
  readonly nome: string;
  readonly corpo: string;
}

export interface CompositorDeMensagemProps {
  readonly pacienteNome: string;
  readonly telefone: string;
  readonly templates: readonly TemplateMensagem[];
  readonly templateSelecionadoId: string;
  readonly aoMudarTemplate: (templateId: string) => void;
  readonly aoEnviar: () => Promise<void>;
  readonly aoFechar: () => void;
}

export function CompositorDeMensagem(p: CompositorDeMensagemProps) {
  const [enviando, setEnviando] = useState(false);
  const selecionado = p.templates.find((t) => t.templateId === p.templateSelecionadoId);

  async function enviar(): Promise<void> {
    setEnviando(true);
    try {
      await p.aoEnviar();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div style={{
      display: 'grid', gap: 'var(--s-4)', padding: 'var(--s-5)',
      border: '1px solid var(--accent)', borderRadius: 'var(--r-md)',
      background: 'var(--surface)', boxShadow: 'var(--elev-1)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          Enviar mensagem
        </h3>
        <button type="button" aria-label="Fechar compositor" onClick={p.aoFechar}
          style={{ border: 0, background: 'transparent', cursor: 'pointer',
                   color: 'var(--text-muted)', fontSize: 'var(--fs-15)' }}>
          &times;
        </button>
      </div>

      <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
        <span style={{ fontSize: 'var(--fs-13)', fontWeight: 'var(--fw-medium)' }}>
          {p.pacienteNome}
        </span>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
          {p.telefone}
        </span>
      </div>

      <label htmlFor="template-selector" style={{ fontSize: 'var(--fs-12)',
                                                   color: 'var(--text-muted)' }}>
        Template
      </label>
      <select id="template-selector" aria-label="Template"
        value={p.templateSelecionadoId}
        onChange={(e) => p.aoMudarTemplate(e.target.value)}
        style={{ height: 40, border: 'var(--border)', borderRadius: 'var(--r-md)',
                 background: 'var(--surface)', color: 'var(--text)' }}>
        {p.templates.map((t) => (
          <option key={t.templateId} value={t.templateId}>{t.nome}</option>
        ))}
      </select>

      {selecionado !== undefined ? (
        <div style={{
          padding: 'var(--s-4)', background: 'var(--surface-sunken)',
          borderRadius: 'var(--r-md)', fontSize: 'var(--fs-13)',
          lineHeight: 'var(--lh-read)', whiteSpace: 'pre-wrap',
        }}>
          {selecionado.corpo}
        </div>
      ) : null}

      <Botao variante="primario" carregando={enviando}
        onClick={() => { void enviar(); }}>
        Enviar
      </Botao>
    </div>
  );
}
