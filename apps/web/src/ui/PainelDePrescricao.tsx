// apps/web/src/ui/PainelDePrescricao.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Warning } from '@phosphor-icons/react';
import { PainelLateral } from './PainelLateral';

/** Sessao do prescritor, vinda de POST /v1/prescricoes/sessao. */
export interface SessaoDoPrescritor {
  readonly scriptUrl: string;
  readonly token: string;
  readonly patientPayload: Readonly<Record<string, string>>;
}

export interface PainelDePrescricaoProps {
  readonly aberto: boolean;
  /** `null` quando a Memed nao respondeu: a consulta continua, a receita nao. */
  readonly sessao: SessaoDoPrescritor | null;
  readonly aoConfirmar: (dados: { providerPrescriptionId: string })
    => Promise<{ prescriptionId: string }>;
  readonly aoFechar: () => void;
}

/* ── superficie do MdHub que usamos ───────────────────────────────────── */

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

/** O evento traz o id como numero; nosso backend guarda texto. */
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
  // Ausencia vira FALSE, nunca true: tratar "nao sei" como "assinada" e mandar
  // o paciente para a farmacia com um papel sem validade.
  return v === true || v === 1 || v === '1' || v === 'true';
}

/**
 * A prescricao da Memed, embarcada.
 *
 * A Memed nao e uma API REST que a gente chama para criar receita: e um MODULO
 * JS que roda dentro da nossa tela. O backend so emite o token do prescritor; o
 * medico prescreve na interface deles, e a assinatura ICP-Brasil acontece la.
 * Quando ele imprime, o evento `prescricaoImpressa` volta com o id, e so entao
 * registramos a receita no nosso prontuario.
 *
 * Por isso a confirmacao nao pode ser um botao nosso: botao nosso registraria
 * receita que talvez nao exista do lado deles.
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

    // Prontidao NAO e o `load` do script. `integration.js` carrega e so entao
    // monta o MdHub, avisando pelo evento `MdSinapsePrescricao` no document.
    // Agir no onload encontra MdHub indefinido e desiste de uma sessao que
    // estava a caminho — foi exatamente o que aconteceu contra a Memed real.
    let sondagem: ReturnType<typeof setInterval> | null = null;
    const pararSondagem = (): void => {
      if (sondagem !== null) { clearInterval(sondagem); sondagem = null; }
    };
    const conferir = (): void => { if (hub() !== null) { setCarregado(true); pararSondagem(); } };

    document.addEventListener('MdSinapsePrescricao', conferir);
    conferir();

    // Sondagem curta ALEM do evento. Contra a Memed real o evento dispara na
    // janela entre montar o efeito e o listener existir, e o painel ficava
    // eternamente em "Abrindo a prescricao" com MdHub.initialized === true na
    // pagina. Depender de um evento unico de terceiro que nao controlamos e
    // apostar numa corrida; sondar por 20s remove a aposta e para sozinho.
    let tentativas = 0;
    sondagem = setInterval(() => {
      tentativas += 1;
      conferir();
      if (tentativas > 130) { pararSondagem(); setErro('A prescricao nao respondeu.'); }
    }, 150);

    const existente = document.getElementById(ID_SCRIPT);
    if (existente === null) {
      const s = document.createElement('script');
      s.id = ID_SCRIPT;
      s.src = sessao.scriptUrl;
      // O token vai em `data-token`, jamais na URL: query string aparece em log
      // de servidor, em cabecalho Referer e no historico do navegador.
      s.dataset['token'] = sessao.token;
      s.dataset['color'] = getComputedStyle(document.documentElement)
        .getPropertyValue('--brand').trim();
      s.async = true;
      s.onload = conferir;
      s.onerror = () => setErro('Nao foi possivel carregar a prescricao.');
      document.body.appendChild(s);
      // O script NAO e removido na desmontagem: a Memed registra estado global e
      // recarregar a cada abertura do painel derrubaria a receita em andamento.
    }

    return () => {
      document.removeEventListener('MdSinapsePrescricao', conferir);
      pararSondagem();
    };
  }, [sessao]);

  /* ── prepara o modulo e escuta a impressao ───────────────────────────── */
  useEffect(() => {
    if (!carregado || sessao === null) return undefined;
    // `carregado` so vira true depois de MdHub existir, entao aqui ele existe.
    const h = hub();
    if (h === null) return undefined;

    const aoImprimir = (evento: unknown): void => {
      const id = idDaPrescricao(evento);
      setSemAssinatura(!foiAssinada(evento));
      if (id === null) { setErro('A receita foi emitida sem identificador.'); return; }
      void p.aoConfirmar({ providerPrescriptionId: id })
        .then((r) => setConfirmada(r.prescriptionId))
        .catch(() => setErro('A receita saiu, mas nao foi registrada no prontuario.'));
    };
    h.event.add('prescricaoImpressa', aoImprimir);

    void (async () => {
      try {
        // Ordem deliberada: paciente primeiro, depois as regras de assinatura,
        // e so entao o modulo aparece. Mostrar antes faz o medico ver a tela
        // vazia e digitar o nome do paciente que ja tinhamos.
        await h.command.send(MODULO, 'setPaciente', sessao.patientPayload);
        // forceSign: receita sem assinatura ICP-Brasil nao vale em farmacia, e o
        // medico so descobre quando o paciente volta.
        await h.command.send(MODULO, 'setFeatureToggle', {
          forceSign: true, deletePrescription: false, removePatient: false,
        });
        if (!jaAbriu.current) { jaAbriu.current = true; await h.module.show(MODULO); }
      } catch {
        setErro('Nao foi possivel preparar a prescricao.');
      }
    })();

    return () => { h.event.remove('prescricaoImpressa', aoImprimir); };
  }, [carregado, sessao, p]);

  return (
    <PainelLateral aberto={p.aberto} titulo="Prescrever" aoFechar={p.aoFechar}>
      {sessao === null ? (
        <p className="text-sm text-text-muted">
          Prescricao indisponivel no momento. O atendimento continua normalmente;
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
                Receita emitida <strong>sem assinatura</strong> digital. A farmacia
                pode recusar. Emita novamente com o certificado do prescritor.
              </span>
            </p>
          )}

          {confirmada !== null && (
            <p className="text-sm text-text">Receita registrada no prontuario.</p>
          )}

          {!carregado && erro === null && (
            <p className="text-sm text-text-muted">Abrindo a prescricao…</p>
          )}

          <p className="text-xs text-text-muted">
            A prescricao abre em janela propria da Memed. Ao imprimir, a receita e
            registrada automaticamente neste atendimento.
          </p>
        </div>
      )}
    </PainelLateral>
  );
}
