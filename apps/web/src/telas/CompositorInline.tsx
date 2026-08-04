'use client';

import { useEffect, useRef, useState } from 'react';
import { ComboboxDePaciente, type PacienteHit } from '../ui/ComboboxDePaciente';
import { Campo } from '../ui/Campo';
import { Botao } from '../ui/Botao';

export interface ProcedimentoOpcao {
  readonly id: string; readonly nome: string;
  readonly duracaoMin: number; readonly maisFrequente: boolean;
}
export interface ConvenioOpcao {
  readonly nome: string; readonly ultimoDoPaciente: boolean;
}

export interface CompositorInlineProps {
  readonly inicioIso: string;
  readonly procedimentos: readonly ProcedimentoOpcao[];
  readonly convenios: readonly ConvenioOpcao[];
  readonly buscarPacientes: (termo: string) => Promise<PacienteHit[]>;
  readonly aoCriarPaciente: (nome: string) =>
    Promise<{ patientId: string; displayName: string }> | void;
  readonly aoAgendar: (i: {
    patientId: string; procedureId: string; operadoraNome: string; encaixe: boolean;
  }) => Promise<{ appointmentId: string }> | Promise<void>;
  readonly aoFechar: () => void;
}

export function CompositorInline(p: CompositorInlineProps) {
  const [paciente, setPaciente] = useState<{ patientId: string; displayName: string } | null>(null);
  const [telefone, setTelefone] = useState('');
  const [precisaTelefone, setPrecisaTelefone] = useState(false);
  const [procedureId, setProcedureId] = useState(
    p.procedimentos.find((x) => x.maisFrequente)?.id ?? p.procedimentos[0]?.id ?? '');
  const [convenio, setConvenio] = useState(
    p.convenios.find((x) => x.ultimoDoPaciente)?.nome ?? p.convenios[0]?.nome ?? 'Particular');
  const [conflito, setConflito] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);
  const [tocado, setTocado] = useState(false);
  const telefoneRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (precisaTelefone) telefoneRef.current?.focus();
  }, [precisaTelefone]);

  async function agendar(encaixe: boolean): Promise<void> {
    if (paciente === null) return;
    setSalvando(true);
    try {
      await p.aoAgendar({ patientId: paciente.patientId, procedureId,
                          operadoraNome: convenio, encaixe });
      setConflito(false);
    } catch (e) {
      if ((e as { codigo?: string }).codigo === 'horario_ocupado') setConflito(true);
      else throw e;
    } finally {
      setSalvando(false);
    }
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLFormElement>): void {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void agendar(false);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (tocado) setConfirmandoDescarte(true);
      else p.aoFechar();
    }
  }

  return (
    <form
      role="form" aria-label="Novo agendamento" onKeyDown={aoTeclar}
      onSubmit={(e) => { e.preventDefault(); void agendar(false); }}
      style={{
        display: 'grid', gap: 'var(--s-4)', padding: 'var(--s-5)',
        border: '1px solid var(--accent)', borderRadius: 'var(--r-md)',
        background: 'var(--surface)', boxShadow: 'var(--elev-1)',
      }}
    >
      {paciente === null ? (
        <ComboboxDePaciente
          rotulo="Quem"
          autoFocus
          buscar={(t) => { setTocado(true); return p.buscarPacientes(t); }}
          aoEscolher={(h) => setPaciente({ patientId: h.patientId, displayName: h.displayName })}
          aoCriar={(nome) => {
            const r = p.aoCriarPaciente(nome);
            if (r instanceof Promise) {
              void r.then((novo) => { setPaciente(novo); setPrecisaTelefone(true); });
            }
          }}
        />
      ) : (
        <p style={{ margin: 0, fontWeight: 'var(--fw-medium)' }}>{paciente.displayName}</p>
      )}

      {precisaTelefone ? (
        <Campo
          ref={telefoneRef as never}
          rotulo="Telefone" inputMode="numeric" value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault();
            (e.currentTarget.form?.elements.namedItem('procedimento') as HTMLElement)?.focus(); } }}
        />
      ) : null}

      <label htmlFor="procedimento" style={{ fontSize: 'var(--fs-12)',
                                             color: 'var(--text-muted)' }}>
        Procedimento
      </label>
      <select id="procedimento" name="procedimento" value={procedureId}
        onChange={(e) => setProcedureId(e.target.value)}
        style={{ height: 40, border: 'var(--border)', borderRadius: 'var(--r-md)',
                 background: 'var(--surface)', color: 'var(--text)' }}>
        {p.procedimentos.map((x) => (
          <option key={x.id} value={x.id}>{`${x.nome} · ${x.duracaoMin} min`}</option>
        ))}
      </select>

      <label htmlFor="convenio" style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
        Convênio
      </label>
      <select id="convenio" value={convenio} onChange={(e) => setConvenio(e.target.value)}
        style={{ height: 40, border: 'var(--border)', borderRadius: 'var(--r-md)',
                 background: 'var(--surface)', color: 'var(--text)' }}>
        {p.convenios.map((c) => <option key={c.nome} value={c.nome}>{c.nome}</option>)}
        <option value="Particular">Particular</option>
      </select>

      {conflito ? (
        <div role="alert" style={{ display: 'grid', gap: 'var(--s-3)' }}>
          <span style={{ color: 'var(--danger)', fontSize: 'var(--fs-13)' }}>
            Já existe atendimento neste horário para o profissional.
          </span>
          <Botao variante="secundario" onClick={() => { void agendar(true); }}>
            Encaixar mesmo assim
          </Botao>
        </div>
      ) : null}

      <Botao type="submit" carregando={salvando}>Salvar (Ctrl+Enter)</Botao>

      {confirmandoDescarte ? (
        <div role="alertdialog" aria-label="Descartar agendamento?"
             style={{ display: 'grid', gap: 'var(--s-3)' }}>
          <span>Descartar o que foi digitado?</span>
          <div style={{ display: 'flex', gap: 'var(--s-3)' }}>
            <Botao variante="secundario" onClick={() => setConfirmandoDescarte(false)}>
              Continuar editando
            </Botao>
            <Botao variante="fantasma" onClick={p.aoFechar}>Descartar</Botao>
          </div>
        </div>
      ) : null}
    </form>
  );
}
