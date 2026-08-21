'use client';

import { useEffect, useState } from 'react';
import { WarningOctagon } from '@phosphor-icons/react';
import { Botao } from './Botao';
import { Modal } from './Modal';

/**
 * Quebra-vidro: acesso de emergencia a prontuario restrito.
 *
 * A rota `POST /v1/pacientes/:id/quebra-vidro` existia desde a Fase 3 e NAO
 * tinha tela nenhuma. O unico ponto do produto que falava em acesso restrito
 * era um botao "Solicitar acesso" na ficha do paciente, ligado a uma funcao
 * vazia: o profissional clicava, nada acontecia, e a conclusao razoavel era que
 * o prontuario simplesmente estava inacessivel.
 *
 * As regras NAO sao repetidas aqui — quem valida e `clin.break_glass`, no banco,
 * na mesma transacao que grava a concessao e emite o evento de auditoria. O que
 * a tela faz e (a) impedir o envio obviamente invalido, poupando uma ida ao
 * servidor para devolver 422, e (b) dizer ao profissional, ANTES de ele
 * confirmar, que o acesso e nominal, tem prazo e fica registrado. Um quebra-
 * vidro que nao avisa disso e uma armadilha: a pessoa descobre a auditoria
 * depois de acionar.
 *
 * O minimo de 20 caracteres e do banco. Reproduzi-lo no cliente e duplicacao
 * consciente e de mao unica: o cliente so REJEITA antes, nunca aceita o que o
 * banco recusaria. Se a regra do banco endurecer, aqui continua valido pedir
 * mais — o 422 volta a aparecer e ninguem passa por engano.
 */
const MINIMO_JUSTIFICATIVA = 20;

const PRAZOS = [
  { horas: 1, rotulo: '1 hora' },
  { horas: 4, rotulo: '4 horas' },
  { horas: 12, rotulo: '12 horas' },
  { horas: 24, rotulo: '24 horas' },
] as const;

export interface DialogoDeQuebraVidroProps {
  readonly aberto: boolean;
  readonly nomeDoPaciente: string;
  readonly aoFechar: () => void;
  readonly aoConfirmar: (dados: {
    justificativa: string; horas: number;
  }) => Promise<void>;
}

export function DialogoDeQuebraVidro({
  aberto, nomeDoPaciente, aoFechar, aoConfirmar,
}: DialogoDeQuebraVidroProps) {
  const [justificativa, setJustificativa] = useState('');
  const [horas, setHoras] = useState<number>(4);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /* Reabrir nao pode herdar a justificativa do acesso anterior: cada quebra-
     vidro e um evento proprio e a justificativa e o que a auditoria guarda. */
  useEffect(() => {
    if (!aberto) return;
    setJustificativa('');
    setHoras(4);
    setErro(null);
  }, [aberto]);

  const faltam = MINIMO_JUSTIFICATIVA - justificativa.trim().length;
  const podeEnviar = faltam <= 0 && !enviando;

  async function confirmar(): Promise<void> {
    if (!podeEnviar) return;
    setEnviando(true);
    setErro(null);
    try {
      await aoConfirmar({ justificativa: justificativa.trim(), horas });
      aoFechar();
    } catch {
      setErro('Não foi possível liberar o acesso. Nenhuma autorização foi criada.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      aberto={aberto}
      titulo="Acesso de emergência ao prontuário"
      descricao={`Liberação temporária e auditada do prontuário de ${nomeDoPaciente}.`}
      largura="md"
      ocupado={enviando}
      aoFechar={aoFechar}
      rodape={(
        <div className="flex flex-wrap justify-end gap-2">
          <Botao variante="secundario" onClick={aoFechar} disabled={enviando}>Cancelar</Botao>
          <Botao onClick={() => { void confirmar(); }} carregando={enviando} disabled={!podeEnviar}>
            Liberar acesso
          </Botao>
        </div>
      )}
    >
      <div className="space-y-5">
        <div className="flex gap-3 rounded-xl border border-warn/25 bg-warn-soft p-4">
          <WarningOctagon size={22} weight="fill" className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <div className="min-w-0 text-sm leading-relaxed text-text-secondary">
            <p className="font-semibold text-text">Este acesso fica registrado no seu nome.</p>
            <p className="mt-1">
              A liberação é nominal, expira sozinha no prazo escolhido e entra na trilha de
              auditoria da clínica junto com a justificativa que você escrever. Use apenas quando
              o cuidado do paciente não puder esperar pela autorização comum.
            </p>
          </div>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-text">
            Por que você precisa deste acesso agora?
          </span>
          <textarea
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            rows={4}
            maxLength={1000}
            autoFocus
            aria-describedby="quebra-vidro-ajuda"
            className="w-full resize-y rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-text outline-none transition-all-fast placeholder:text-text-faint focus:border-accent focus:ring-4 focus:ring-accent-soft"
            placeholder="Ex.: paciente em atendimento de urgência, preciso conferir alergias e medicações em uso."
          />
          <span id="quebra-vidro-ajuda" className="mt-1.5 block text-xs text-text-faint">
            {faltam > 0
              ? `Faltam ${faltam} caractere${faltam === 1 ? '' : 's'} — a justificativa fica na auditoria e precisa explicar a urgência.`
              : 'A justificativa será registrada junto com a liberação.'}
          </span>
        </label>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-text">Por quanto tempo</legend>
          <div className="flex flex-wrap gap-2">
            {PRAZOS.map((p) => (
              <button
                key={p.horas}
                type="button"
                aria-pressed={horas === p.horas}
                onClick={() => setHoras(p.horas)}
                className={horas === p.horas
                  ? 'rounded-xl border border-accent bg-accent-soft px-4 py-2 text-sm font-semibold text-accent'
                  : 'rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-text-muted hover:border-line-strong hover:text-text'}
              >
                {p.rotulo}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-text-faint">
            Passado o prazo, o prontuário volta a exigir autorização — sem precisar revogar nada.
          </p>
        </fieldset>

        {erro !== null ? (
          <p role="alert" className="rounded-xl border border-danger/20 bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
            {erro}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
