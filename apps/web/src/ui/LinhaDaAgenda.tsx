'use client';

import { ChipDeStatus, type StatusAgenda } from './ChipDeStatus';

export interface LinhaDaAgendaProps {
  readonly hora: string;
  readonly paciente: string;
  readonly profissional: string;
  readonly procedimento?: string;
  readonly convenio?: string;
  readonly status: StatusAgenda;
  readonly encaixe: boolean;
  readonly cadastroPreliminar?: boolean;
  readonly primeiraVez?: boolean;
  readonly teleconsulta?: boolean;
  readonly aoAbrir?: () => void;
}

const TOKEN_STATUS: Record<StatusAgenda, string> = {
  agendado: '--st-agendado', confirmado: '--st-confirmado', aguardando: '--st-aguardando',
  atendendo: '--st-atendendo', atendido: '--st-atendido', faltou: '--st-faltou',
  cancelado: '--st-cancelado',
};

export function LinhaDaAgenda(p: LinhaDaAgendaProps) {
  return (
    <li
      data-encaixe={p.encaixe ? 'true' : 'false'}
      onClick={p.aoAbrir}
      style={{
        display: 'grid',
        gridTemplateColumns: '64px 1fr auto auto',
        alignItems: 'center', gap: 'var(--s-5)',
        borderLeft: `3px solid var(${TOKEN_STATUS[p.status]})`,
        borderBottom: 'var(--border)',
        background: p.encaixe
          ? 'repeating-linear-gradient(45deg, var(--surface) 0 6px, var(--surface-sunken) 6px 12px)'
          : 'var(--surface)',
        padding: `var(--s-4) var(--s-5)`, minHeight: 44, cursor: p.aoAbrir ? 'pointer' : 'default',
      }}
    >
      <span className="num" style={{ fontSize: 'var(--fs-13)', color: 'var(--text-muted)' }}>
        {p.hora}
      </span>
      <span>
        <strong style={{ fontWeight: 'var(--fw-medium)' }}>{p.paciente}</strong>
        <span style={{ display: 'block', fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
          {p.profissional}
          {p.procedimento === undefined ? '' : ` · ${p.procedimento}`}
          {p.convenio === undefined ? '' : ` · ${p.convenio}`}
          {p.encaixe ? ' · encaixe' : ''}
          {p.cadastroPreliminar === true ? ' · cadastro preliminar' : ''}
          {p.primeiraVez === true ? ' · 1ª vez' : ''}
          {p.teleconsulta === true ? ' · teleconsulta' : ''}
        </span>
      </span>
      <ChipDeStatus status={p.status} />
    </li>
  );
}
