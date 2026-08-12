'use client';

import { useCallback } from 'react';
import { AutomacoesDeConversa, type Automacao } from '../../../src/telas/AutomacoesDeConversa';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';

interface RegraDaApi {
  ruleId: string;
  trigger: string;
  channelIdentityId: string;
  templateId: string;
  timingOffsetMinutes: number;
  active: boolean;
  channel: string;
  updatedAt: string;
}

interface TemplateDaApi { templateId: string; name: string }

/**
 * Os gatilhos, em português de recepção.
 *
 * A API fala `APPOINTMENT_CREATED`; quem configura a clínica fala "quando marca
 * a consulta". Traduzir na borda mantém o domínio estável e a tela legível —
 * mostrar a constante crua faria a recepcionista ter medo de mexer.
 */
const GATILHOS: Record<string, { nome: string; descricao: string }> = {
  APPOINTMENT_CREATED: {
    nome: 'Confirmação de agendamento',
    descricao: 'Assim que a consulta é marcada, o paciente recebe os dados.',
  },
  APPOINTMENT_REMINDER: {
    nome: 'Lembrete da consulta',
    descricao: 'Antes do horário, para reduzir falta.',
  },
  APPOINTMENT_CANCELLED: {
    nome: 'Aviso de cancelamento',
    descricao: 'Quando a consulta é desmarcada.',
  },
  ENCOUNTER_FINALIZED: {
    nome: 'Pós-consulta',
    descricao: 'Depois do atendimento fechado, com orientações e pesquisa.',
  },
};

/** "-1440" é um dia ANTES; "60" é uma hora depois. Minuto cru não se lê. */
function timingLegivel(minutos: number): string {
  if (minutos === 0) return 'na hora';
  const abs = Math.abs(minutos);
  const quando = minutos < 0 ? 'antes' : 'depois';
  if (abs % 1440 === 0) {
    const d = abs / 1440;
    return `${d} ${d === 1 ? 'dia' : 'dias'} ${quando}`;
  }
  if (abs % 60 === 0) {
    const h = abs / 60;
    return `${h} ${h === 1 ? 'hora' : 'horas'} ${quando}`;
  }
  return `${abs} min ${quando}`;
}

export default function PaginaAutomacoes() {
  const { clinicId, csrfToken } = useSessao();

  const carregar = useCallback(async (): Promise<Automacao[]> => {
    const [regras, templates] = await Promise.all([
      apiFetch<{ itens: RegraDaApi[] }>(
        '/v1/messaging/automations', { clinicId, csrfToken }),
      apiFetch<{ itens: TemplateDaApi[] }>(
        '/v1/messaging/templates', { clinicId, csrfToken })
        .catch(() => ({ itens: [] as TemplateDaApi[] })),
    ]);
    const nomeDoTemplate = new Map(templates.itens.map((t) => [t.templateId, t.name]));

    return regras.itens.map((x) => {
      const g = GATILHOS[x.trigger];
      return {
        automationId: x.ruleId,
        nome: g?.nome ?? x.trigger,
        descricao: g?.descricao ?? '',
        // Template apagado ou de outro canal: mostra o que se sabe em vez de
        // ficar em branco, senão a regra parece quebrada quando só falta nome.
        templateNome: nomeDoTemplate.get(x.templateId) ?? 'template sem nome',
        canal: (x.channel === 'sms' || x.channel === 'email' ? x.channel : 'whatsapp'),
        timing: timingLegivel(x.timingOffsetMinutes),
        ativa: x.active,
      };
    });
  }, [clinicId, csrfToken]);

  return (
    <div className="grid gap-6">
      <AutomacoesDeConversa
        carregar={carregar}
        aoAlternarAtiva={async (automationId, novoEstado) => {
          // A API grava a regra INTEIRA, não um campo. Reenviar só `active`
          // apagaria gatilho, template e timing — então lemos a regra vigente e
          // devolvemos ela com o interruptor trocado.
          const atuais = await apiFetch<{ itens: RegraDaApi[] }>(
            '/v1/messaging/automations', { clinicId, csrfToken });
          const alvo = atuais.itens.find((x) => x.ruleId === automationId);
          if (alvo === undefined) return;
          await apiFetch('/v1/messaging/automations', {
            method: 'POST',
            body: {
              rules: [{
                ruleId: alvo.ruleId,
                channelIdentityId: alvo.channelIdentityId,
                trigger: alvo.trigger,
                templateId: alvo.templateId,
                timingOffsetMinutes: alvo.timingOffsetMinutes,
                active: novoEstado,
                channel: alvo.channel,
              }],
            },
            clinicId, csrfToken,
          });
        }}
      />
    </div>
  );
}
