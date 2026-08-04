'use client';

import { useEffect, useState } from 'react';
import type { PacienteHit } from '../ui/ComboboxDePaciente';

export interface Faceta { readonly chave: string; readonly rotulo: string }

export const FACETAS: readonly Faceta[] = [
  { chave: 'ativos', rotulo: 'Ativos' },
  { chave: 'inativos', rotulo: 'Inativos' },
  { chave: 'obitos', rotulo: 'Óbitos' },
  { chave: 'cadastro_preliminar', rotulo: 'Cadastro preliminar' },
  { chave: 'sem_retorno', rotulo: 'Sem retorno há 6 meses' },
];

export interface PacientesProps {
  readonly faceta: string;
  readonly buscar: (termo: string, faceta: string) => Promise<PacienteHit[]>;
  readonly aoMudarFaceta: (faceta: string) => void;
  readonly aoAbrir: (patientId: string) => void;
}

export function Pacientes(p: PacientesProps) {
  const [termo, setTermo] = useState('');
  const [itens, setItens] = useState<PacienteHit[]>([]);

  useEffect(() => { void p.buscar(termo, p.faceta).then(setItens); }, [p, termo, p.faceta]);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
        Pacientes
      </h1>

      <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
        {FACETAS.map((f) => (
          <button key={f.chave} type="button" aria-pressed={p.faceta === f.chave}
            onClick={() => p.aoMudarFaceta(f.chave)}
            style={{
              border: 'var(--border)', borderRadius: 'var(--r-full)', minHeight: 28,
              padding: `0 var(--s-5)`, fontSize: 'var(--fs-13)', cursor: 'pointer',
              background: p.faceta === f.chave ? 'var(--accent-soft)' : 'var(--surface)',
              color: 'var(--text)',
            }}>
            {f.rotulo}
          </button>
        ))}
      </div>

      <label htmlFor="busca-pacientes" style={{ fontSize: 'var(--fs-12)',
                                                color: 'var(--text-muted)' }}>
        Buscar
      </label>
      <input id="busca-pacientes" value={termo} onChange={(e) => setTermo(e.target.value)}
        style={{ height: 40, border: 'var(--border)', borderRadius: 'var(--r-md)',
                 padding: `0 var(--s-4)`, background: 'var(--surface)', color: 'var(--text)' }} />

      <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)',
                      border: 'var(--border)', borderRadius: 'var(--r-md)' }}>
        <thead>
          <tr>
            {['Nome', 'Nascimento', 'Telefone', 'Cadastro'].map((h) => (
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
          {itens.map((x) => (
            <tr key={x.patientId} onClick={() => p.aoAbrir(x.patientId)}
                style={{ cursor: 'pointer', borderBottom: 'var(--border)' }}>
              <td style={{ padding: 'var(--s-4)' }}>{x.displayName}</td>
              <td className="num" style={{ padding: 'var(--s-4)' }}>{x.birthDate ?? '—'}</td>
              <td className="num" style={{ padding: 'var(--s-4)' }}>{x.phonePrimary ?? '—'}</td>
              <td style={{ padding: 'var(--s-4)',
                           color: x.cadastroStatus === 'preliminar'
                             ? 'var(--warn)' : 'var(--text-muted)' }}>
                {x.cadastroStatus === 'preliminar' ? 'preliminar' : 'completo'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
