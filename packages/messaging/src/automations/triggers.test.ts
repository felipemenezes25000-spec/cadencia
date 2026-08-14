import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_TRIGGERS, exigeConsentimentoDeMarketing,
  type AutomationTrigger,
} from './confirmation';

const MIGRATION = resolve(__dirname, '../../../db/migrations/0182_automation_triggers.sql');

describe('catalogo de gatilhos', () => {
  it('a lista do app e o CHECK do banco nao divergem', () => {
    /* Divergir aqui deixa o app aceitar uma regra que o banco recusa no INSERT
       — erro que so aparece em producao, no primeiro tenant que configurar. */
    const sql = readFileSync(MIGRATION, 'utf8');
    const bloco = /CHECK \(trigger IN \(([\s\S]*?)\)\)/.exec(sql)?.[1] ?? '';
    const noBanco = [...bloco.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(noBanco).toEqual([...AUTOMATION_TRIGGERS].sort());
  });

  it('os quatro gatilhos originais continuam no catalogo', () => {
    /* Remover um deles quebraria regra ja configurada em tenant existente. */
    for (const t of ['appointment_created', 'appointment_reminder',
                     'encounter_finalized', 'nps_due'] as const) {
      expect(AUTOMATION_TRIGGERS).toContain(t);
    }
  });

  it('nao ha gatilho repetido', () => {
    expect(new Set(AUTOMATION_TRIGGERS).size).toBe(AUTOMATION_TRIGGERS.length);
  });
});

describe('base legal LGPD por gatilho', () => {
  it('aniversario e reativacao exigem consentimento de marketing', () => {
    /* Nao cabem na tutela da saude (art. 7, VIII): sao uso secundario. */
    expect(exigeConsentimentoDeMarketing('patient_birthday')).toBe(true);
    expect(exigeConsentimentoDeMarketing('patient_inactive')).toBe(true);
  });

  it('o que e execucao do atendimento ou do contrato NAO exige', () => {
    const semConsentimento: readonly AutomationTrigger[] = [
      'appointment_created', 'appointment_reminder', 'encounter_finalized',
      'nps_due', 'appointment_no_show', 'recall_due', 'payment_overdue',
    ];
    for (const t of semConsentimento) {
      expect(exigeConsentimentoDeMarketing(t), t).toBe(false);
    }
  });

  it('todo gatilho do catalogo tem a pergunta respondida', () => {
    for (const t of AUTOMATION_TRIGGERS) {
      expect(typeof exigeConsentimentoDeMarketing(t), t).toBe('boolean');
    }
  });
});
