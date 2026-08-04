'use client';

import { useState } from 'react';
import { Botao } from '../ui/Botao';
import type { PacienteHit } from '../ui/ComboboxDePaciente';

export type PapelNaTela = 'profissional' | 'recepcao' | 'financeiro'
                        | 'admin_clinico' | 'diretor_tecnico';

export interface FichaDoPacienteProps {
  readonly paciente: PacienteHit;
  readonly papel: PapelNaTela;
  readonly pendentes: readonly string[];
  readonly prontuarioAcessivel: boolean;
  readonly existeMasSemAcesso: boolean;
  readonly carregarProntuario: () => Promise<unknown[]>;
  readonly aoSolicitarAcesso: () => void;
  readonly aoQuebrarVidro: (justificativa: string, horas: number) => Promise<void>;
}

const CLINICOS = new Set<PapelNaTela>(['profissional', 'admin_clinico', 'diretor_tecnico']);

export function FichaDoPaciente(p: FichaDoPacienteProps) {
  const veProntuario = CLINICOS.has(p.papel);
  const [aba, setAba] = useState<'perfil' | 'atendimentos' | 'prontuario'>('perfil');
  const [pedindoVidro, setPedindoVidro] = useState(false);
  const [justificativa, setJustificativa] = useState('');

  const abas: { chave: typeof aba; rotulo: string }[] = [
    { chave: 'perfil', rotulo: 'Perfil' },
    { chave: 'atendimentos', rotulo: 'Atendimentos' },
    ...(veProntuario ? [{ chave: 'prontuario' as const, rotulo: 'Prontuário' }] : []),
  ];

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)', padding: 'var(--s-8)' }}>
      <header style={{ display: 'grid', gap: 'var(--s-2)' }}>
        <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          {p.paciente.displayName}
        </h1>
        {p.pendentes.length > 0 ? (
          <p role="status" style={{
            margin: 0, fontSize: 'var(--fs-13)', color: 'var(--warn)',
            background: 'var(--warn-soft)', padding: `var(--s-3) var(--s-4)`,
            borderRadius: 'var(--r-md)',
          }}>
            {`${p.pendentes.length} dados pendentes`}
            <span style={{ color: 'var(--text-muted)' }}>{` · ${p.pendentes.join(', ')}`}</span>
          </p>
        ) : null}
      </header>

      <div role="tablist" aria-label="Seções do paciente" style={{ display: 'flex',
                                                                   gap: 'var(--s-1)' }}>
        {abas.map((a) => (
          <button key={a.chave} role="tab" type="button" aria-selected={aba === a.chave}
            onClick={() => setAba(a.chave)}
            style={{
              border: 0, borderBottom: aba === a.chave
                ? '2px solid var(--accent)' : '2px solid transparent',
              background: 'transparent', color: aba === a.chave
                ? 'var(--text)' : 'var(--text-muted)',
              minHeight: 32, padding: `0 var(--s-5)`, cursor: 'pointer',
              fontSize: 'var(--fs-14)',
            }}>
            {a.rotulo}
          </button>
        ))}
      </div>

      {aba === 'prontuario' && !p.prontuarioAcessivel ? (
        <section aria-label="Prontuário indisponível"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)',
                   display: 'grid', gap: 'var(--s-4)' }}>
          <p style={{ margin: 0 }}>
            {p.existeMasSemAcesso
              ? 'Paciente existe. Prontuário não compartilhado com você.'
              : 'Nenhum prontuário encontrado para este paciente.'}
          </p>
          {p.existeMasSemAcesso ? (
            <div style={{ display: 'flex', gap: 'var(--s-3)' }}>
              <Botao variante="secundario" onClick={p.aoSolicitarAcesso}>
                Solicitar acesso
              </Botao>
              <Botao variante="fantasma" onClick={() => setPedindoVidro(true)}>
                Quebra-vidro assistencial
              </Botao>
            </div>
          ) : null}

          {pedindoVidro ? (
            <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
              <label htmlFor="jv" style={{ fontSize: 'var(--fs-12)',
                                           color: 'var(--text-muted)' }}>
                Justificativa (mínimo 20 caracteres, registrada na auditoria)
              </label>
              <textarea id="jv" value={justificativa} rows={3}
                onChange={(e) => setJustificativa(e.target.value)}
                style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                         padding: 'var(--s-4)', background: 'var(--surface)',
                         color: 'var(--text)', fontFamily: 'var(--font-ui)' }} />
              <Botao
                disabled={justificativa.trim().length < 20}
                onClick={() => { void p.aoQuebrarVidro(justificativa.trim(), 4); }}>
                Confirmar quebra-vidro
              </Botao>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
