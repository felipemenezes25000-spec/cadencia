'use client';

import { useEffect, useState } from 'react';
import { EditorClinico, type CodigoHit, type ModeloHit, type ValorAnterior } from './EditorClinico';
import { PainelLateral } from '../ui/PainelLateral';

export interface TelaDeAtendimentoProps {
  readonly encounterId: string;
  readonly pacienteNome: string;
  readonly abrirSessaoDoPrescritor: () => Promise<{ mode: string }>;
  readonly buscarCodigo: (termo: string) => Promise<CodigoHit[]>;
  readonly buscarModelo: (termo: string) => Promise<ModeloHit[]>;
  readonly buscarValorAnterior: (campo: string) => Promise<ValorAnterior | null>;
  readonly aoConfirmarPrescricao: () => Promise<{ prescriptionId: string }>;
  readonly aoFinalizar: () => Promise<{ versionId: string; versionNo: number }>;
}

export function TelaDeAtendimento(p: TelaDeAtendimentoProps) {
  const [prescricaoAberta, setPrescricaoAberta] = useState(false);
  const [finalizado, setFinalizado] = useState(false);

  useEffect(() => {
    void p.abrirSessaoDoPrescritor();
  }, []);

  async function finalizar() {
    await p.aoFinalizar();
    setFinalizado(true);
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', height: '100vh' }}>
      <div style={{ display: 'grid', gap: 'var(--s-4)', padding: 'var(--s-6)',
                    gridTemplateRows: 'auto 1fr auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between',
                         alignItems: 'center' }}>
          <h1 style={{ fontSize: 'var(--fs-18)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
            {p.pacienteNome}
          </h1>
        </header>

        <EditorClinico
          encounterId={p.encounterId}
          buscarCodigo={p.buscarCodigo}
          buscarModelo={p.buscarModelo}
          buscarValorAnterior={p.buscarValorAnterior}
          aoPrescrever={() => setPrescricaoAberta(true)}
          aoPedirExame={() => {}}
          aoEmitirDocumento={() => {}}
          aoFinalizar={() => { void finalizar(); }}
        />

        {finalizado ? (
          <div role="status" style={{ display: 'flex', gap: 'var(--s-4)',
                                      alignItems: 'center', justifyContent: 'center',
                                      padding: 'var(--s-4)', background: 'var(--success-soft)',
                                      borderRadius: 'var(--r-md)' }}>
            <span style={{ color: 'var(--success)' }}>Atendimento finalizado</span>
            <button type="button"
              style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                       background: 'var(--surface)', padding: 'var(--s-3) var(--s-5)',
                       cursor: 'pointer', color: 'var(--text)' }}>
              Próximo paciente (Enter)
            </button>
          </div>
        ) : null}
      </div>

      <PainelLateral aberto={prescricaoAberta} titulo="Prescrever"
        aoFechar={() => setPrescricaoAberta(false)}>
        <p style={{ margin: 0 }}>Prescrição embarcada para {p.pacienteNome}</p>
      </PainelLateral>
    </div>
  );
}
