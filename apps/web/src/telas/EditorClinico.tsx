'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ATALHOS_DO_ATENDIMENTO } from './atalhos';

export interface CodigoHit { readonly code: string; readonly display: string }
export interface ModeloHit { readonly code: string; readonly texto: string }
export interface ValorAnterior { readonly valor: string; readonly em: string }

export interface EditorClinicoProps {
  readonly encounterId: string;
  readonly buscarCodigo: (termo: string) => Promise<CodigoHit[]>;
  readonly buscarModelo: (termo: string) => Promise<ModeloHit[]>;
  readonly buscarValorAnterior: (campo: string) => Promise<ValorAnterior | null>;
  readonly aoPrescrever: () => void;
  readonly aoPedirExame: () => void;
  readonly aoEmitirDocumento: () => void;
  readonly aoFinalizar: () => void;
}

const MAPA_ATALHOS: Record<string, string> = {};
for (const a of ATALHOS_DO_ATENDIMENTO) {
  const partes = a.combinacao.split('+');
  const tecla = partes.at(-1)!.toLowerCase();
  MAPA_ATALHOS[tecla] = a.acao;
}

export function EditorClinico(p: EditorClinicoProps) {
  const [segundos, setSegundos] = useState(0);
  const intervalo = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalo.current = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => { if (intervalo.current) clearInterval(intervalo.current); };
  }, []);

  const minutos = Math.floor(segundos / 60);
  const segs = segundos % 60;

  function aoTeclar(e: KeyboardEvent) {
    if (!e.ctrlKey && !e.metaKey) return;

    const tecla = e.key.toLowerCase();
    const acao = MAPA_ATALHOS[tecla];
    if (acao === undefined) return;

    e.preventDefault();
    switch (acao) {
      case 'prescrever': p.aoPrescrever(); break;
      case 'pedir_exame': p.aoPedirExame(); break;
      case 'emitir_documento': p.aoEmitirDocumento(); break;
      case 'finalizar': p.aoFinalizar(); break;
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
          {`Duração: ${String(minutos).padStart(2, '0')}:${String(segs).padStart(2, '0')}`}
        </span>
        <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
          {ATALHOS_DO_ATENDIMENTO.slice(0, 4).map((a) => (
            <kbd key={a.acao} title={a.descricao}
              style={{ fontSize: 'var(--fs-11)', color: 'var(--text-muted)',
                       border: 'var(--border)', borderRadius: 'var(--r-sm)',
                       padding: '0 var(--s-2)', lineHeight: '20px' }}>
              {a.combinacao}
            </kbd>
          ))}
        </div>
      </div>

      <article
        role="article"
        aria-label="Editor clínico"
        contentEditable
        suppressContentEditableWarning
        onKeyDown={aoTeclar}
        style={{
          flex: 1, minHeight: 300, border: 'var(--border)', borderRadius: 'var(--r-md)',
          padding: 'var(--s-5)', background: 'var(--surface)', color: 'var(--text)',
          fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-14)', lineHeight: 1.7,
          outline: 'none', overflowY: 'auto',
        }}
      />
    </div>
  );
}
