import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;

const AUDIO = Buffer.from('audio simulado da consulta').toString('base64');

beforeAll(async () => { s = await semearSessao({ role: 'profissional' }); });
afterAll(async () => { await closePools(); });

describe('transcricao por IA', () => {
  it('devolve SUGESTAO e nao escreve no prontuario', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: `/v1/atendimentos/${s.encounterId}/transcricao`,
      payload: { audioBase64: AUDIO, contentType: 'audio/webm' },
      ...auth(s) });

    expect(r.statusCode).toBe(201);
    const j = r.json() as {
      aiAssistanceId: string;
      sugestao: { evolucao: string; cid: { codigo: string } | null; confianca: number };
      transcricao: { texto: string; falas: { locutor: string }[] };
    };

    expect(j.sugestao.evolucao).toBeTruthy();
    expect(j.sugestao.cid?.codigo).toBe('R51');
    // A diarizacao separa quem falou. Sem isso a queixa do paciente pode acabar
    // registrada como conduta do medico.
    expect(j.transcricao.falas.map((f) => f.locutor)).toContain('PACIENTE');

    // O RASCUNHO continua vazio: quem escreve no prontuario e o medico.
    const rascunho = await app.inject({
      method: 'GET', url: `/v1/atendimentos/${s.encounterId}/rascunho`, ...auth(s) });
    expect((rascunho.json() as { payload: Record<string, unknown> }).payload)
      .toEqual({});

    await app.close();
  });

  it('registra a assistencia com decisao NAO AVALIADA e a residencia do dado', async () => {
    const a = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
    try {
      const { rows } = await a.query<{
        clinician_decision: string; residency: string; provider: string;
        purpose: string; risk_class: string;
      }>(
        `SELECT clinician_decision::text, residency, provider, purpose, risk_class
           FROM clin.ai_assistance WHERE encounter_id = $1
          ORDER BY created_at DESC LIMIT 1`, [s.encounterId]);

      expect(rows).toHaveLength(1);
      // `nao_avaliado` ate um humano decidir. Nascer como aceito poria no acervo
      // texto que ninguem leu — e o acervo e assinado pelo medico.
      expect(rows[0]?.clinician_decision).toBe('nao_avaliado');
      // A residencia e a resposta para "para onde foi o audio da consulta".
      expect(rows[0]?.residency).toBeTruthy();
      expect(rows[0]?.provider).toBeTruthy();
    } finally { await a.end(); }
  });

  it('paciente que RECUSOU IA bloqueia a transcricao', async () => {
    const a = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
    try {
      await a.query(
        `UPDATE clin.patient SET ai_refused_at = clock_timestamp()
          WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.patientId]);
    } finally { await a.end(); }

    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: `/v1/atendimentos/${s.encounterId}/transcricao`,
      payload: { audioBase64: AUDIO, contentType: 'audio/webm' },
      ...auth(s) });

    // A recusa e do PACIENTE e vale contra a clinica inteira. Ignora-la seria
    // processar dado de saude contra vontade expressa do titular.
    expect(r.statusCode).toBe(403);
    expect((r.json() as { erro: string }).erro).toBe('paciente_recusou_ia');
    await app.close();
  });

  it('recepcao nao transcreve consulta', async () => {
    const app = await buildApp();
    const recepcao = await semearSessao({ role: 'recepcao' });
    const r = await app.inject({
      method: 'POST', url: `/v1/atendimentos/${recepcao.encounterId}/transcricao`,
      payload: { audioBase64: AUDIO, contentType: 'audio/webm' },
      ...auth(recepcao) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
