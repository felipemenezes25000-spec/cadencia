'use client';

import { useState } from 'react';
import { VideoCamera, X } from '@phosphor-icons/react';
import { Botao } from './Botao';

export type StatusTeleconsulta = 'aguardando' | 'em_andamento' | 'encerrada';

export interface DadosTeleconsulta {
  readonly id: string;
  readonly roomUrl: string;
  readonly roomId: string;
  readonly provider: string;
  readonly endedAt: string | null;
}

export interface PainelDeTeleconsultaProps {
  readonly teleconsulta: DadosTeleconsulta | null;
  readonly aoIniciar: () => Promise<DadosTeleconsulta>;
  readonly aoEncerrar: (id: string) => Promise<void>;
}

function statusDa(tc: DadosTeleconsulta | null): StatusTeleconsulta {
  if (tc === null) return 'aguardando';
  if (tc.endedAt !== null) return 'encerrada';
  return 'em_andamento';
}

const ROTULO_STATUS: Record<StatusTeleconsulta, string> = {
  aguardando: 'Aguardando',
  em_andamento: 'Em andamento',
  encerrada: 'Encerrada',
};

const COR_STATUS: Record<StatusTeleconsulta, string> = {
  aguardando: 'text-text-muted',
  em_andamento: 'text-success',
  encerrada: 'text-text-muted',
};

export function PainelDeTeleconsulta({
  teleconsulta,
  aoIniciar,
  aoEncerrar,
}: PainelDeTeleconsultaProps) {
  const [tc, setTc] = useState<DadosTeleconsulta | null>(teleconsulta);
  const [iframeAberto, setIframeAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const status = statusDa(tc);

  const iniciar = async () => {
    setCarregando(true);
    setErro(null);
    try {
      const dados = await aoIniciar();
      setTc(dados);
      setIframeAberto(true);
    } catch {
      setErro('Nao foi possivel criar a teleconsulta.');
    } finally {
      setCarregando(false);
    }
  };

  const encerrar = async () => {
    if (tc === null) return;
    setCarregando(true);
    try {
      await aoEncerrar(tc.id);
      setTc({ ...tc, endedAt: 'encerrada' });
      setIframeAberto(false);
    } catch {
      setErro('Nao foi possivel encerrar.');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="rounded-lg border border-border p-4 space-y-3" data-testid="painel-teleconsulta">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Teleconsulta</h3>
        <span className={`text-xs ${COR_STATUS[status]}`} data-testid="status-teleconsulta">
          {ROTULO_STATUS[status]}
        </span>
      </div>

      {erro !== null && (
        <p className="text-xs text-danger" role="alert">{erro}</p>
      )}

      {status === 'aguardando' && (
        <Botao
          variante="primario"
          tamanho="sm"
          iconeEsquerda={VideoCamera}
          carregando={carregando}
          onClick={iniciar}
        >
          Iniciar teleconsulta
        </Botao>
      )}

      {status === 'em_andamento' && !iframeAberto && (
        <Botao
          variante="secundario"
          tamanho="sm"
          iconeEsquerda={VideoCamera}
          onClick={() => setIframeAberto(true)}
        >
          Abrir sala
        </Botao>
      )}

      {status === 'em_andamento' && iframeAberto && tc !== null && (
        <div className="space-y-2">
          <div className="relative w-full aspect-video rounded-md overflow-hidden border border-border">
            <iframe
              src={tc.roomUrl}
              title="Teleconsulta"
              className="absolute inset-0 w-full h-full"
              allow="camera; microphone; display-capture"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
            <button
              type="button"
              className="absolute top-2 right-2 p-1 rounded bg-black/50 text-white hover:bg-black/70"
              onClick={() => setIframeAberto(false)}
              aria-label="Minimizar"
            >
              <X size={16} />
            </button>
          </div>
          <Botao
            variante="perigo"
            tamanho="sm"
            carregando={carregando}
            onClick={encerrar}
          >
            Encerrar teleconsulta
          </Botao>
        </div>
      )}

      {status === 'encerrada' && (
        <p className="text-xs text-text-muted">Esta teleconsulta foi encerrada.</p>
      )}
    </div>
  );
}
