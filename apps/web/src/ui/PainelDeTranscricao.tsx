// apps/web/src/ui/PainelDeTranscricao.tsx
'use client';

import { useRef, useState } from 'react';
import { Microphone, Stop, Warning } from '@phosphor-icons/react';
import { PainelLateral } from './PainelLateral';
import { Botao } from './Botao';

export interface SugestaoDaIA {
  readonly evolucao: string;
  readonly alergias: string | null;
  readonly pesoKg: string | null;
  readonly alturaCm: string | null;
  readonly paSistolica: string | null;
  readonly paDiastolica: string | null;
  readonly cid: { readonly codigo: string; readonly descricao: string } | null;
  readonly confianca: number;
}

export interface PainelDeTranscricaoProps {
  readonly aberto: boolean;
  readonly aoTranscrever: (audio: Blob) => Promise<SugestaoDaIA>;
  /** Aplica os campos que o medico aceitou. Nunca e chamado sozinho. */
  readonly aoAceitar: (s: SugestaoDaIA, campos: ReadonlySet<string>) => void;
  readonly aoFechar: () => void;
}

/**
 * Transcricao da consulta por IA.
 *
 * O medico grava, a IA sugere, e o MEDICO decide campo a campo. Nada e escrito
 * no prontuario sem alguem marcar a caixa — porque o acervo clinico e assinado
 * por ele, e texto que ninguem leu nao pode chegar la.
 *
 * O aviso ao paciente nao e formalidade: gravar consulta sem avisar e ilegal, e
 * a recusa dele bloqueia a transcricao no servidor (`clin.patient.ai_refused_at`).
 * A tela avisa quem grava; o banco garante quem recusou.
 */

const CAMPOS: readonly { id: string; rotulo: string }[] = [
  { id: 'evolucao', rotulo: 'Evolucao' },
  { id: 'alergias', rotulo: 'Alergias' },
  { id: 'pesoKg', rotulo: 'Peso' },
  { id: 'alturaCm', rotulo: 'Altura' },
  { id: 'pa', rotulo: 'Pressao arterial' },
  { id: 'cid', rotulo: 'CID' },
];

function valorDoCampo(s: SugestaoDaIA, id: string): string | null {
  if (id === 'evolucao') return s.evolucao === '' ? null : s.evolucao;
  if (id === 'alergias') return s.alergias;
  if (id === 'pesoKg') return s.pesoKg === null ? null : `${s.pesoKg} kg`;
  if (id === 'alturaCm') return s.alturaCm === null ? null : `${s.alturaCm} cm`;
  if (id === 'pa') {
    return s.paSistolica !== null && s.paDiastolica !== null
      ? `${s.paSistolica}/${s.paDiastolica} mmHg` : null;
  }
  if (id === 'cid') return s.cid === null ? null : `${s.cid.codigo} — ${s.cid.descricao}`;
  return null;
}

export function PainelDeTranscricao(p: PainelDeTranscricaoProps) {
  const [gravando, setGravando] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sugestao, setSugestao] = useState<SugestaoDaIA | null>(null);
  const [aceitos, setAceitos] = useState<ReadonlySet<string>>(new Set());
  const gravador = useRef<MediaRecorder | null>(null);
  const pedacos = useRef<Blob[]>([]);

  async function comecar(): Promise<void> {
    setErro(null);
    setSugestao(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      pedacos.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) pedacos.current.push(e.data); };
      mr.onstop = () => {
        // A trilha e encerrada explicitamente: sem isto o indicador de microfone
        // do sistema fica aceso depois da consulta, e o proximo paciente entra
        // na sala com a luz vermelha piscando.
        stream.getTracks().forEach((t) => { t.stop(); });
        void processar(new Blob(pedacos.current, { type: 'audio/webm' }));
      };
      mr.start();
      gravador.current = mr;
      setGravando(true);
    } catch {
      setErro('Nao foi possivel acessar o microfone. Verifique a permissao do navegador.');
    }
  }

  function parar(): void {
    gravador.current?.stop();
    gravador.current = null;
    setGravando(false);
  }

  async function processar(audio: Blob): Promise<void> {
    setProcessando(true);
    try {
      const s = await p.aoTranscrever(audio);
      setSugestao(s);
      // NADA vem marcado. Pre-marcar transformaria "sugestao" em "padrao", e
      // quem esta com pressa aceitaria tudo sem ler — que e exatamente o modo
      // de falha que a decisao do medico existe para impedir.
      setAceitos(new Set());
    } catch {
      setErro('Nao foi possivel transcrever. O atendimento continua normalmente.');
    } finally {
      setProcessando(false);
    }
  }

  function alternar(id: string): void {
    setAceitos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id); else novo.add(id);
      return novo;
    });
  }

  return (
    <PainelLateral aberto={p.aberto} titulo="Transcrever consulta" aoFechar={p.aoFechar}>
      <div className="grid gap-4">
        <p className="flex items-start gap-2 rounded-[var(--r-sm)] border border-warn/40 bg-warn/5 p-3 text-sm text-text">
          <Warning size={18} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0 text-warn" />
          <span>
            Avise o paciente antes de gravar. Se ele recusar, a transcricao fica
            bloqueada para ele em todo o sistema.
          </span>
        </p>

        {!gravando && !processando && (
          <Botao iconeEsquerda={Microphone} onClick={() => { void comecar(); }}>
            Comecar a gravar
          </Botao>
        )}
        {gravando && (
          <Botao variante="secundario" iconeEsquerda={Stop} onClick={parar}>
            Parar e transcrever
          </Botao>
        )}
        {processando && <p className="text-sm text-text-muted">Transcrevendo…</p>}

        {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}

        {sugestao !== null && (
          <section className="grid gap-3">
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-semibold text-text">Sugestoes</h3>
              <span className="text-xs text-text-muted">
                confianca {Math.round(sugestao.confianca * 100)}%
              </span>
            </div>

            <ul className="grid gap-1.5">
              {CAMPOS.map((c) => {
                const v = valorDoCampo(sugestao, c.id);
                if (v === null) return null;
                return (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--r-sm)] border border-line p-2.5 text-sm hover:bg-surface-hover">
                      <input
                        type="checkbox"
                        checked={aceitos.has(c.id)}
                        onChange={() => alternar(c.id)}
                        className="mt-0.5 accent-[var(--accent)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium uppercase tracking-wide text-text-muted">
                          {c.rotulo}
                        </span>
                        <span className="block whitespace-pre-wrap text-text">{v}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <Botao
              disabled={aceitos.size === 0}
              onClick={() => { p.aoAceitar(sugestao, aceitos); }}
            >
              {aceitos.size === 0
                ? 'Marque o que aceita'
                : `Usar ${aceitos.size} ${aceitos.size === 1 ? 'campo' : 'campos'}`}
            </Botao>

            <p className="text-xs text-text-muted">
              Só o que você marcar entra no prontuário. A gravação não é guardada.
            </p>
          </section>
        )}
      </div>
    </PainelLateral>
  );
}
