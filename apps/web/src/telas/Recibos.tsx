'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';

export type MetodoRecibo = 'dinheiro' | 'cartao' | 'pix' | 'link';

export interface LinhaDeRecibo {
  readonly receiptId: string;
  readonly receiptNumber: number;
  readonly patientName: string;
  readonly description: string;
  readonly amountCents: number;
  readonly method: MetodoRecibo;
  readonly paidAt: string;
}

export interface RecibosProps {
  readonly carregarRecibos: (filtros: {
    dataInicio?: string; dataFim?: string; paciente?: string;
  }) => Promise<LinhaDeRecibo[]>;
  readonly aoImprimirRecibo: (receiptId: string) => Promise<void>;
}

const ROTULO_METODO: Record<MetodoRecibo, string> = {
  dinheiro: 'Dinheiro', cartao: 'Cartão', pix: 'Pix', link: 'Link',
};

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

function formatarDataHora(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }).format(d);
}

export function Recibos(p: RecibosProps) {
  const [recibos, setRecibos] = useState<LinhaDeRecibo[]>([]);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [paciente, setPaciente] = useState('');

  useEffect(() => {
    void p.carregarRecibos({}).then(setRecibos);
  }, [p]);

  function filtrar(): void {
    void p.carregarRecibos({
      dataInicio: dataInicio === '' ? undefined : dataInicio,
      dataFim: dataFim === '' ? undefined : dataFim,
      paciente: paciente === '' ? undefined : paciente,
    }).then(setRecibos);
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)',
                  maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Recibos
      </h1>

      <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap', alignItems: 'end' }}>
        <Campo rotulo="Data início" type="date" denso
          value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
          aria-label="Data início" />
        <Campo rotulo="Data fim" type="date" denso
          value={dataFim} onChange={(e) => setDataFim(e.target.value)}
          aria-label="Data fim" />
        <Campo rotulo="Paciente" denso
          value={paciente} onChange={(e) => setPaciente(e.target.value)}
          aria-label="Paciente" placeholder="Nome do paciente" />
        <Botao variante="secundario" altura={32} onClick={filtrar}>
          Filtrar
        </Botao>
      </div>

      <section aria-label="Lista de recibos">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {recibos.map((r) => (
            <li key={r.receiptId}
              style={{ display: 'grid',
                       gridTemplateColumns: 'auto 1fr auto auto',
                       alignItems: 'center', gap: 'var(--s-5)',
                       borderBottom: 'var(--border)',
                       padding: 'var(--s-4) var(--s-5)', minHeight: 44 }}>
              <span className="num" style={{ fontSize: 'var(--fs-13)',
                                             color: 'var(--text-muted)',
                                             fontVariantNumeric: 'tabular-nums' }}>
                #{r.receiptNumber}
              </span>
              <div>
                <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                  {r.patientName}
                </span>
                <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                               color: 'var(--text-muted)' }}>
                  {r.description} — {ROTULO_METODO[r.method]} — {formatarDataHora(r.paidAt)}
                </span>
              </div>
              <span className="num" style={{ fontSize: 'var(--fs-14)',
                                             fontVariantNumeric: 'tabular-nums' }}>
                {centavosParaReais(r.amountCents)}
              </span>
              <Botao variante="fantasma" altura={28}
                aria-label={`Imprimir recibo ${r.receiptNumber}`}
                onClick={() => { void p.aoImprimirRecibo(r.receiptId); }}>
                Imprimir
              </Botao>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
