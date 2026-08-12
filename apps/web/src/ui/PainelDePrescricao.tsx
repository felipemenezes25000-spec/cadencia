// apps/web/src/ui/PainelDePrescricao.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Warning } from '@phosphor-icons/react';
import { PainelLateral } from './PainelLateral';

/** Sessão do prescritor, vinda de POST /v1/prescricoes/sessao. */
export interface SessaoDoPrescritor {
  readonly scriptUrl: string;
  readonly token: string;
  readonly patientPayload: Readonly<Record<string, string>>;
}

export interface PainelDePrescricaoProps {
  readonly aberto: boolean;
  /** `null` quando a Memed não respondeu: a consulta continua, a receita não. */
  readonly sessao: SessaoDoPrescritor | null;
  readonly aoConfirmar: (dados: { providerPrescriptionId: string })
    => Promise<{ prescriptionId: string }>;
  readonly aoFechar: () => void;
}

/* ── superfície do MdHub que usamos ───────────────────────────────────── */

interface MdHub {
  command: { send: (modulo: string, comando: string, args?: unknown) => Promise<unknown> };
  module: { show: (modulo: string) => Promise<unknown> };
  event: {
    add: (nome: string, cb: (e: unknown) => void) => void;
    remove: (nome: string, cb?: (e: unknown) => void) => void;
  };
}

const MODULO = 'plataforma.prescricao';
const ID_SCRIPT = 'memed-sinapse-prescricao';

function hub(): MdHub | null {
  const g = globalThis as unknown as { MdHub?: MdHub };
  return g.MdHub ?? null;
}

/** O evento traz o id como número; nosso backend guarda texto. */
function idDaPrescricao(evento: unknown): string | null {
  if (typeof evento !== 'object' || evento === null) return null;
  const p = (evento as { prescricao?: { id?: unknown } }).prescricao;
  const id = p?.id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  if (typeof id === 'string' && id !== '') return id;
  return null;
}

function foiAssinada(evento: unknown): boolean {
  if (typeof evento !== 'object' || evento === null) return false;
  const v = (evento as { signed?: unknown }).signed;
  // Ausência vira FALSE, nunca true: tratar "não sei" como "assinada" é mandar
  // o paciente para a farmácia com um papel sem validade.
  return v === true || v === 1 || v === '1' || v === 'true';
}

/**
 * A prescrição da Memed, embarcada.
 *
 * A Memed não é uma API REST que a gente chama para criar receita: é um MÓDULO
 * JS que roda dentro da nossa tela. O backend só emite o token do prescritor; o
 * médico prescreve na interface deles, e a assinatura ICP-Brasil acontece lá.
 * Quando ele imprime, o evento `prescricaoImpressa` volta com o id, e só então
 * registramos a receita no nosso prontuário.
 *
 * Por isso a confirmação não pode ser um botão nosso: botão nosso registraria
 * receita que talvez não exista do lado deles.
 */
export function PainelDePrescricao(p: PainelDePrescricaoProps) {
  const { sessao } = p;
  const [erro, setErro] = useState<string | null>(null);
  const [semAssinatura, setSemAssinatura] = useState(false);
  const [confirmada, setConfirmada] = useState<string | null>(null);
  const [carregado, setCarregado] = useState(false);
  const jaAbriu = useRef(false);

  /* ── injeta o script e espera a Memed ficar PRONTA ───────────────────── */
  useEffect(() => {
    if (sessao === null) return undefined;

    // Prontidão NÃO é o `load` do script. `integration.js` carrega e só então
    // monta o MdHub, avisando pelo evento `MdSinapsePrescricao` no document.
    // Agir no onload encontra MdHub indefinido e desiste de uma sessão que
    // estava a caminho — foi exatamente o que aconteceu contra a Memed real.
    let sondagem: ReturnType<typeof setInterval> | null = null;
    const pararSondagem = (): void => {
      if (sondagem !== null) { clearInterval(sondagem); sondagem = null; }
    };
    const conferir = (): void => { if (hub() !== null) { setCarregado(true); pararSondagem(); } };

    document.addEventListener('MdSinapsePrescricao', conferir);
    conferir();

    // Sondagem curta ALÉM do evento. Contra a Memed real o evento dispara na
    // janela entre montar o efeito e o listener existir, e o painel ficava
    // eternamente em "Abrindo a prescrição" com MdHub.initialized === true na
    // página. Depender de um evento único de terceiro que não controlamos é
    // apostar numa corrida; sondar por 20s remove a aposta e para sozinho.
    let tentativas = 0;
    sondagem = setInterval(() => {
      tentativas += 1;
      conferir();
      if (tentativas > 130) { pararSondagem(); setErro('A prescrição não respondeu.'); }
    }, 150);

    const existente = document.getElementById(ID_SCRIPT);
    if (existente === null) {
      const s = document.createElement('script');
      s.id = ID_SCRIPT;
      s.src = sessao.scriptUrl;
      // O token vai em `data-token`, jamais na URL: query string aparece em log
      // de servidor, em cabeçalho Referer e no histórico do navegador.
      s.dataset['token'] = sessao.token;
      s.dataset['color'] = '#2f6f6a';
      s.async = true;
      s.onload = conferir;
      s.onerror = () => setErro('Não foi possível carregar a prescrição.');
      document.body.appendChild(s);
      // O script NÃO é removido na desmontagem: a Memed registra estado global e
      // recarregar a cada abertura do painel derrubaria a receita em andamento.
    }

    return () => {
      document.removeEventListener('MdSinapsePrescricao', conferir);
      pararSondagem();
    };
  }, [sessao]);

  /* ── prepara o módulo e escuta a impressão ───────────────────────────── */
  useEffect(() => {
    if (!carregado || sessao === null) return undefined;
    // `carregado` só vira true depois de MdHub existir, então aqui ele existe.
    const h = hub();
    if (h === null) return undefined;

    const aoImprimir = (evento: unknown): void => {
      const id = idDaPrescricao(evento);
      setSemAssinatura(!foiAssinada(evento));
      if (id === null) { setErro('A receita foi emitida sem identificador.'); return; }
      void p.aoConfirmar({ providerPrescriptionId: id })
        .then((r) => setConfirmada(r.prescriptionId))
        .catch(() => setErro('A receita saiu, mas não foi registrada no prontuário.'));
    };
    h.event.add('prescricaoImpressa', aoImprimir);

    void (async () => {
      try {
        // Ordem deliberada: paciente primeiro, depois as regras de assinatura,
        // e só então o módulo aparece. Mostrar antes faz o médico ver a tela
        // vazia e digitar o nome do paciente que já tínhamos.
        await h.command.send(MODULO, 'setPaciente', sessao.patientPayload);
        // forceSign: receita sem assinatura ICP-Brasil não vale em farmácia, e o
        // médico só descobre quando o paciente volta.
        await h.command.send(MODULO, 'setFeatureToggle', {
          forceSign: true, deletePrescription: false, removePatient: false,
        });
        if (!jaAbriu.current) { jaAbriu.current = true; await h.module.show(MODULO); }
      } catch {
        setErro('Não foi possível preparar a prescrição.');
      }
    })();

    return () => { h.event.remove('prescricaoImpressa', aoImprimir); };
  }, [carregado, sessao, p]);

  return (
    <PainelLateral aberto={p.aberto} titulo="Prescrever" aoFechar={p.aoFechar}>
      {sessao === null ? (
        <p className="text-sm text-text-muted">
          Prescrição indisponível no momento. O atendimento continua normalmente;
          tente novamente em instantes.
        </p>
      ) : (
        <div className="grid gap-3">
          {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}

          {semAssinatura && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-[var(--r-sm)] border border-danger/40 bg-danger/5 p-3 text-sm text-danger"
            >
              <Warning size={18} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>
                Receita emitida <strong>sem assinatura</strong> digital. A farmácia
                pode recusar. Emita novamente com o certificado do prescritor.
              </span>
            </p>
          )}

          {confirmada !== null && (
            <p className="text-sm text-text">Receita registrada no prontuário.</p>
          )}

          {!carregado && erro === null && (
            <p className="text-sm text-text-muted">Abrindo a prescrição…</p>
          )}

          <p className="text-xs text-text-muted">
            A prescrição abre em janela própria da Memed. Ao imprimir, a receita é
            registrada automaticamente neste atendimento.
          </p>
        </div>
      )}
    </PainelLateral>
  );
}
