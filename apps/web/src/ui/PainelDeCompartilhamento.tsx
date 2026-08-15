// apps/web/src/ui/PainelDeCompartilhamento.tsx
'use client';

import { useState } from 'react';
import { ShareNetwork, Warning } from '@phosphor-icons/react';
import { PainelLateral } from './PainelLateral';
import { Botao } from './Botao';

export interface Compartilhamento {
  readonly shareId: string;
  readonly granteeProfessionalId: string;
  readonly granteeNome: string;
  readonly concedidoPor: string;
  readonly motivo: string;
  /** Instante absoluto. O deslocamento é o da sessão do Postgres, não o da unidade. */
  readonly concedidoEm: string;
  readonly expiraEm: string | null;
  readonly quebraVidro: boolean;
}

export interface NovoCompartilhamento {
  readonly granteeProfessionalId: string;
  readonly reason: string;
  /** `null` = não expira. Nunca `0`, que significaria "expira agora". */
  readonly diasDeValidade: number | null;
}

export interface PainelDeCompartilhamentoProps {
  readonly aberto: boolean;
  readonly paciente: string;
  /** Fuso da unidade (`vinculoAtivo.timezone`). Define as datas exibidas. */
  readonly timezone: string;
  readonly itens: readonly Compartilhamento[];
  readonly profissionais: readonly { professionalId: string; nome: string }[];
  readonly aoCompartilhar: (c: NovoCompartilhamento) => Promise<void>;
  readonly aoRevogar: (shareId: string) => Promise<void>;
  readonly aoFechar: () => void;
}

/** O mesmo mínimo que a API exige: motivo que explica, não que preenche. */
const MOTIVO_MINIMO = 5;

const PRAZOS: readonly { valor: string; rotulo: string }[] = [
  { valor: '7', rotulo: '7 dias' },
  { valor: '30', rotulo: '30 dias' },
  { valor: '90', rotulo: '90 dias' },
  { valor: '', rotulo: 'Sem prazo (permanente)' },
];

/**
 * A data no fuso da CLÍNICA para um instante absoluto.
 *
 * A rota formata com `to_char(..., 'OF:00')`, que usa o fuso da SESSÃO do
 * Postgres — UTC —, e não o da unidade. Recortar os 10 primeiros caracteres
 * anunciaria 01/09 para um acesso que vence às 23:00 do dia 31 em São Paulo: um
 * dia a mais de permissão na tela que o banco não concede.
 */
function dataNaClinica(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone, day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date(iso));
}

/**
 * Compartilhar o prontuário com outro profissional.
 *
 * A política RESTRICTIVE `clinical_scope` em `clin.encounter` tem três portas:
 * quem atendeu, quem tem escopo amplo, e quem consta em `clin.record_share`.
 * Esta tela é a terceira porta — sem ela o colega vê 404 e não há como liberar.
 *
 * O motivo é obrigatório e não aceita "ok" porque a pergunta que a auditoria faz
 * não é "quem acessou", e sim "por que este médico viu este paciente".
 */
export function PainelDeCompartilhamento(p: PainelDeCompartilhamentoProps) {
  const [granteeId, setGranteeId] = useState('');
  const [motivo, setMotivo] = useState('');
  // 30 dias por padrão: o acesso permanente continua possível, mas passa a ser
  // um ato deliberado em vez do que acontece quando ninguém pensa no assunto.
  const [prazo, setPrazo] = useState('30');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmando, setConfirmando] = useState<string | null>(null);

  const incompleto = granteeId === '' || motivo.trim().length < MOTIVO_MINIMO;

  async function compartilhar(): Promise<void> {
    setErro(null);
    setSalvando(true);
    try {
      await p.aoCompartilhar({
        granteeProfessionalId: granteeId,
        reason: motivo.trim(),
        diasDeValidade: prazo === '' ? null : Number(prazo),
      });
      setMotivo('');
      setGranteeId('');
    } catch {
      setErro('Não foi possível liberar o acesso. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  }

  async function revogar(shareId: string): Promise<void> {
    setErro(null);
    try {
      await p.aoRevogar(shareId);
      setConfirmando(null);
    } catch {
      setErro('Não foi possível revogar o acesso.');
    }
  }

  return (
    <PainelLateral
      aberto={p.aberto}
      titulo="Compartilhar prontuário"
      aoFechar={p.aoFechar}
    >
      <div className="grid gap-5">
        <p className="text-sm text-text-muted">
          Quem você liberar aqui passa a ver o prontuário de{' '}
          <strong className="text-text">{p.paciente}</strong>. Todo acesso fica
          registrado com o motivo.
        </p>

        <section className="grid gap-3">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-text">Profissional</span>
            <select
              value={granteeId}
              onChange={(e) => setGranteeId(e.target.value)}
              className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text"
            >
              <option value="">Escolha quem terá acesso</option>
              {p.profissionais.map((x) => (
                <option key={x.professionalId} value={x.professionalId}>{x.nome}</option>
              ))}
            </select>
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-text">Motivo</span>
            <textarea
              rows={2}
              maxLength={500}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Segunda opinião sobre a lesão do joelho direito"
              className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text"
            />
            <span className="text-xs text-text-muted">
              Escreva o que a auditoria precisaria ler daqui a um ano para
              entender por que este colega viu este paciente.
            </span>
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-text">Prazo</span>
            <select
              value={prazo}
              onChange={(e) => setPrazo(e.target.value)}
              className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text"
            >
              {PRAZOS.map((x) => (
                <option key={x.rotulo} value={x.valor}>{x.rotulo}</option>
              ))}
            </select>
          </label>

          {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}

          <Botao
            iconeEsquerda={ShareNetwork}
            disabled={incompleto}
            carregando={salvando}
            onClick={() => compartilhar()}
          >
            Liberar acesso
          </Botao>
        </section>

        <section className="grid gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Quem tem acesso hoje
          </h3>
          {p.itens.length === 0 ? (
            <p className="text-sm text-text-muted">
              Só quem atendeu este paciente vê o prontuário dele.
            </p>
          ) : (
            <ul className="grid gap-1.5">
              {p.itens.map((c) => (
                <li key={c.shareId}
                  className="rounded-[var(--r-sm)] border border-line bg-surface p-3 text-sm">
                  <p className="flex flex-wrap items-center gap-x-2 font-medium text-text">
                    {c.granteeNome}
                    {c.quebraVidro && (
                      // Acesso de urgência sem consentimento prévio é o primeiro
                      // caso que a auditoria abre. Não pode parecer rotina.
                      <span className="inline-flex items-center gap-1 rounded-full bg-warn/10 px-2 py-0.5 text-xs font-semibold text-warn">
                        <Warning size={12} weight="fill" aria-hidden="true" />
                        Quebra de vidro
                      </span>
                    )}
                  </p>
                  <p className="text-text-muted">{c.motivo}</p>
                  <p className="text-xs text-text-muted">
                    Liberado por {c.concedidoPor === '' ? 'sistema' : c.concedidoPor}
                    {' em '}{dataNaClinica(c.concedidoEm, p.timezone)}
                    {' · '}
                    {/* Campo em branco leria-se como "sem informação"; é o
                        oposto — este acesso não expira sozinho. */}
                    {c.expiraEm === null
                      ? 'sem prazo'
                      : `até ${dataNaClinica(c.expiraEm, p.timezone)}`}
                  </p>

                  {confirmando === c.shareId ? (
                    <div className="mt-2 flex gap-2">
                      <Botao
                        variante="perigo"
                        tamanho="sm"
                        onClick={() => revogar(c.shareId)}
                      >
                        Confirmar
                      </Botao>
                      <Botao
                        variante="fantasma"
                        tamanho="sm"
                        onClick={() => setConfirmando(null)}
                      >
                        Manter
                      </Botao>
                    </div>
                  ) : (
                    <Botao
                      className="mt-2"
                      variante="secundario"
                      tamanho="sm"
                      onClick={() => setConfirmando(c.shareId)}
                    >
                      Revogar
                    </Botao>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PainelLateral>
  );
}
