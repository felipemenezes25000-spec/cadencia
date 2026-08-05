// apps/web/src/telas/TemplatesDeMensagem.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';

export type StatusAprovacao = 'aprovado' | 'pendente' | 'rejeitado';

export interface TemplateAdmin {
  readonly templateId: string;
  readonly nome: string;
  readonly corpo: string;
  readonly canal: 'whatsapp' | 'sms' | 'email';
  readonly statusAprovacao: StatusAprovacao;
}

const COR_STATUS: Record<StatusAprovacao, string> = {
  aprovado:  'var(--success)',
  pendente:  'var(--warn)',
  rejeitado: 'var(--danger)',
};

export interface TemplatesDeMensagemProps {
  readonly carregar: () => Promise<TemplateAdmin[]>;
  readonly aoCriar: () => void;
  readonly aoEditar: (templateId: string) => void;
}

export function TemplatesDeMensagem(p: TemplatesDeMensagemProps) {
  const [templates, setTemplates] = useState<TemplateAdmin[]>([]);

  useEffect(() => {
    void p.carregar().then(setTemplates);
  }, [p]);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          Templates
        </h1>
        <Botao variante="primario" altura={32} onClick={p.aoCriar}>
          Novo template
        </Botao>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)',
                      border: 'var(--border)', borderRadius: 'var(--r-md)' }}>
        <thead>
          <tr>
            {['Nome', 'Canal', 'Status'].map((h) => (
              <th key={h} scope="col" style={{
                textAlign: 'left', fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                letterSpacing: '.04em', color: 'var(--text-muted)', fontWeight: 500,
                padding: 'var(--s-4)', borderBottom: 'var(--border)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.templateId}
              onClick={() => p.aoEditar(t.templateId)}
              style={{ cursor: 'pointer', borderBottom: 'var(--border)' }}>
              <td style={{ padding: 'var(--s-4)', fontWeight: 'var(--fw-medium)' }}>
                {t.nome}
              </td>
              <td style={{ padding: 'var(--s-4)', fontSize: 'var(--fs-13)',
                           color: 'var(--text-muted)' }}>
                {t.canal}
              </td>
              <td style={{ padding: 'var(--s-4)', fontSize: 'var(--fs-13)',
                           color: COR_STATUS[t.statusAprovacao] }}>
                {t.statusAprovacao}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
