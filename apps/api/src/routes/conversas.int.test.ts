import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;
let conversaComPaciente = '';
let conversaAnonima = '';

async function semearConversas(t: SementeSessao): Promise<void> {
  const a = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
  try {
    const identidade = uuidv7();
    await a.query(
      `INSERT INTO msg.channel_identity
         (tenant_id, id, channel, display_name, phone, waba_ref, status)
       VALUES ($1,$2,'whatsapp','Aurora Centro','+551140000000','WABA-1','active')`,
      [t.tenantId, identidade]);

    conversaComPaciente = uuidv7();
    conversaAnonima = uuidv7();

    await a.query(
      `INSERT INTO msg.conversation
         (tenant_id, id, channel_identity_id, patient_id, remote_phone, status,
          last_message_at)
       VALUES ($1,$2,$3,$4,'+5511999990001','active', clock_timestamp()),
              ($1,$5,$3,NULL,'+5511999990002','active',
               clock_timestamp() - interval '1 hour')`,
      [t.tenantId, conversaComPaciente, identidade, t.patientId, conversaAnonima]);

    const msg = async (
      conversa: string, direcao: 'inbound' | 'outbound', texto: string,
      lida: boolean, atrasoMin: number,
    ) => {
      await a.query(
        `INSERT INTO msg.message
           (tenant_id, id, conversation_id, direction, channel, body_text,
            status, read_at, created_at)
         VALUES ($1,$2,$3,$4,'whatsapp',$5,'delivered',
                 CASE WHEN $6 THEN clock_timestamp() END,
                 clock_timestamp() - make_interval(mins => $7::int))`,
        [t.tenantId, uuidv7(), conversa, direcao, texto, lida, atrasoMin]);
    };

    await msg(conversaComPaciente, 'outbound', 'Bom dia! Confirma a consulta?', true, 30);
    await msg(conversaComPaciente, 'inbound', 'Confirmo sim, obrigada', false, 5);
    await msg(conversaAnonima, 'inbound', 'Voces atendem por convenio?', false, 70);
    await msg(conversaAnonima, 'inbound', 'Alo?', false, 65);
  } finally {
    await a.end();
  }
}

beforeAll(async () => {
  s = await semearSessao({ role: 'recepcao' });
  await semearConversas(s);
});
afterAll(async () => { await closePools(); });

describe('caixa de conversas', () => {
  it('GET /v1/conversations traz nome, ultima mensagem e nao-lidas', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/conversations', ...auth(s) });

    expect(r.statusCode).toBe(200);
    const itens = (r.json() as {
      itens: {
        conversationId: string; patientName: string | null;
        lastMessageBody: string; unreadCount: number;
        lastMessageDirection: 'inbound' | 'outbound';
      }[];
    }).itens;

    const comPaciente = itens.find((x) => x.conversationId === conversaComPaciente);
    expect(comPaciente?.patientName).toBe(s.patientNome);
    // A previa e a ULTIMA mensagem, nao a primeira: a caixa e lida de cima para
    // baixo e o que importa e o estado atual da conversa.
    expect(comPaciente?.lastMessageBody).toBe('Confirmo sim, obrigada');
    expect(comPaciente?.lastMessageDirection).toBe('inbound');
    expect(comPaciente?.unreadCount).toBe(1);

    // Numero sem paciente vinculado existe e e comum: quem escreve pela
    // primeira vez ainda nao esta no cadastro.
    const anonima = itens.find((x) => x.conversationId === conversaAnonima);
    expect(anonima?.patientName).toBeNull();
    expect(anonima?.unreadCount).toBe(2);

    await app.close();
  });

  it('a conversa mais recente vem primeiro', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/conversations', ...auth(s) });
    const itens = (r.json() as { itens: { conversationId: string }[] }).itens;
    expect(itens[0]?.conversationId).toBe(conversaComPaciente);
    await app.close();
  });

  it('GET /v1/conversations/:id/contexto traz agenda e pendencias do paciente', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/conversations/${conversaComPaciente}/contexto`, ...auth(s) });

    expect(r.statusCode).toBe(200);
    const d = r.json() as {
      proximoAgendamento: { starts_at?: string } | null;
      pendencias: string[];
      historicoAgendamentos: unknown[];
    };
    // O painel lateral da conversa existe para a recepcao responder sem trocar
    // de tela: sem agenda e pendencia, ela abriria o cadastro em outra aba.
    expect(Array.isArray(d.pendencias)).toBe(true);
    expect(Array.isArray(d.historicoAgendamentos)).toBe(true);

    await app.close();
  });

  it('conversa de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const outro = await semearSessao({ role: 'recepcao' });
    const r = await app.inject({ method: 'GET', url: '/v1/conversations', ...auth(outro) });
    expect((r.json() as { itens: unknown[] }).itens).toHaveLength(0);
    await app.close();
  });
});
