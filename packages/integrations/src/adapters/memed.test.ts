import { describe, expect, it } from 'vitest';
import { createMemedProvider, type MemedConfig } from './memed';
import type { ProviderCtx } from '../contracts/common';

const CONFIG: MemedConfig = {
  // A base ja carrega o /v1: e assim que a Memed documenta os dois ambientes
  // (integrations.api.memed.com.br/v1 e api.memed.com.br/v1).
  baseUrl: 'https://api.memed.exemplo/v1',
  scriptUrl: 'https://memed.exemplo/modulo.js',
  apiKey: 'CHAVE',
  secretKey: 'SEGREDO',
};

const CTX: ProviderCtx = {
  tenantId: '11111111-1111-7111-8111-111111111111',
  actorUserId: '22222222-2222-7222-8222-222222222222',
  requestId: 'req-1',
  idempotencyKey: 'enc-1:prescrever',
  deadlineMs: 3000,
};

const PROFISSIONAL = {
  fullName: 'Helena Vasques', cpf: '11144477735',
  council: 'CRM' as const, number: '100000', uf: 'SP',
};
const PACIENTE = { fullName: 'Ana Beatriz Carvalho', birthDate: '1988-03-12' };

/** JWT sem assinatura valida: so o payload importa para ler o `exp`. */
function jwtQueExpiraEm(epochSegundos: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: epochSegundos })}.assinatura`;
}

const AGORA_MS = Date.UTC(2026, 7, 9, 12, 0, 0);
const relogio = { nowMs: () => AGORA_MS };

interface ChamadaGravada { url: string; init: RequestInit | undefined }

/** Transporte falso: grava a chamada e devolve a resposta programada. */
function transporte(respostas: Array<{ status: number; corpo: unknown }>) {
  const chamadas: ChamadaGravada[] = [];
  let i = 0;
  const fetchFalso: typeof globalThis.fetch = async (entrada, init) => {
    const url = typeof entrada === 'string' ? entrada
      : entrada instanceof URL ? entrada.toString() : entrada.url;
    chamadas.push({ url, init });
    const r = respostas[Math.min(i, respostas.length - 1)];
    i += 1;
    return {
      ok: r!.status >= 200 && r!.status < 300,
      status: r!.status,
      json: async () => r!.corpo,
      arrayBuffer: async () => new TextEncoder().encode(String(r!.corpo)).buffer,
    } as unknown as Response;
  };
  return { chamadas, fetchFalso };
}

describe('adaptador Memed', () => {
  it('busca o prescritor existente por CPF e NAO cadastra de novo', async () => {
    const exp = Math.floor(AGORA_MS / 1000) + 3600;
    const { chamadas, fetchFalso } = transporte([
      { status: 200, corpo: { data: { attributes: { token: jwtQueExpiraEm(exp) } } } },
    ]);
    const p = createMemedProvider(CONFIG, { fetch: fetchFalso, clock: relogio });

    const r = await p.openPrescriberSession(CTX, {
      professional: PROFISSIONAL, patient: PACIENTE, encounterId: 'enc-1' });

    expect(r.ok).toBe(true);
    // GET, nao POST: o token atual vem da CONSULTA. Cadastrar a cada prescricao
    // escreveria na conta de producao da clinica toda vez que um medico abre a
    // receita -- e o POST e "cadastrar", nao "garantir que existe".
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.init?.method ?? 'GET').toBe('GET');
    expect(new URL(chamadas[0]!.url).pathname)
      .toBe('/v1/sinapse-prescricao/usuarios/11144477735');

    await Promise.resolve();
  });

  it('cadastra o prescritor apenas quando a consulta nao o encontra', async () => {
    const exp = Math.floor(AGORA_MS / 1000) + 3600;
    const { chamadas, fetchFalso } = transporte([
      { status: 404, corpo: { errors: [{ detail: 'nao encontrado' }] } },
      { status: 200, corpo: { data: { attributes: { token: jwtQueExpiraEm(exp) } } } },
    ]);
    const p = createMemedProvider(CONFIG, { fetch: fetchFalso, clock: relogio });

    const r = await p.openPrescriberSession(CTX, {
      professional: PROFISSIONAL, patient: PACIENTE, encounterId: 'enc-1' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // 1a chamada: consulta (404). 2a: cadastro.
    expect(chamadas).toHaveLength(2);
    const url = new URL(chamadas[1]!.url);
    expect(url.pathname).toBe('/v1/sinapse-prescricao/usuarios');
    expect(url.searchParams.get('api-key')).toBe('CHAVE');
    expect(url.searchParams.get('secret-key')).toBe('SEGREDO');
    expect(chamadas[1]!.init?.method).toBe('POST');

    const corpo = JSON.parse(String(chamadas[1]!.init?.body)) as {
      data: { type: string; attributes: Record<string, unknown> } };
    expect(corpo.data.type).toBe('usuarios');
    expect(corpo.data.attributes['cpf']).toBe('11144477735');
    // A Memed quer nome e sobrenome separados; o nosso modelo guarda um campo so.
    expect(corpo.data.attributes['nome']).toBe('Helena');
    expect(corpo.data.attributes['sobrenome']).toBe('Vasques');
    expect((corpo.data.attributes['board'] as { board_number: string }).board_number)
      .toBe('100000');

    expect(r.value.mode).toBe('embedded');
    expect(r.value.scriptUrl).toBe(CONFIG.scriptUrl);
    // O vencimento sai do proprio JWT, nao de um prazo que nos inventamos.
    expect(r.value.expiresAt).toBe('2026-08-09T13:00:00.000Z');
  });

  it('recusa token ja vencido em vez de entregar para a tela', async () => {
    const exp = Math.floor(AGORA_MS / 1000) - 60;
    const { fetchFalso } = transporte([
      { status: 200, corpo: { data: { attributes: { token: jwtQueExpiraEm(exp) } } } },
    ]);
    const p = createMemedProvider(CONFIG, { fetch: fetchFalso, clock: relogio });

    const r = await p.openPrescriberSession(CTX, {
      professional: PROFISSIONAL, patient: PACIENTE, encounterId: 'enc-1' });

    // Servir um token vencido faria o modulo JS abrir e falhar dentro da consulta,
    // com o paciente na sala. Falhar aqui e barulhento e recuperavel.
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('rejected');
  });

  it('5xx do parceiro vira unavailable, que e o unico erro que autoriza retry', async () => {
    const { fetchFalso } = transporte([{ status: 503, corpo: { errors: [{ detail: 'fora' }] } }]);
    const p = createMemedProvider(CONFIG, { fetch: fetchFalso, clock: relogio });

    const r = await p.openPrescriberSession(CTX, {
      professional: PROFISSIONAL, patient: PACIENTE, encounterId: 'enc-1' });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('unavailable');
    expect(r.error.retrySafe).toBe(true);
  });

  it('4xx vira rejected e NAO autoriza retry', async () => {
    const { fetchFalso } = transporte([
      { status: 422, corpo: { errors: [{ detail: 'cpf invalido' }] } }]);
    const p = createMemedProvider(CONFIG, { fetch: fetchFalso, clock: relogio });

    const r = await p.openPrescriberSession(CTX, {
      professional: PROFISSIONAL, patient: PACIENTE, encounterId: 'enc-1' });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('rejected');
    expect(r.error.retrySafe).toBe(false);
  });

  it('busca a prescricao juntando os dois recursos documentados', async () => {
    const exp = Math.floor(AGORA_MS / 1000) + 3600;
    const { chamadas, fetchFalso } = transporte([
      // 1) consulta do prescritor -> token atual
      { status: 200, corpo: { data: { attributes: { token: jwtQueExpiraEm(exp) } } } },
      // 2) a prescricao, com a PROVA de assinatura no payload
      { status: 200, corpo: { data: { id: '987', attributes: {
        created_at: '2026-08-09 09:15:00',
        uuid: 'c0ffee00-0000-4000-8000-000000000001',
        signed: 1,
        medicamentos: [{ nome: 'Dipirona 500mg', posologia: '1 cp 6/6h', controle_especial: '0' }],
        documents: [
          { id: 1, uuid: 'doc-full', type: 'full', status: 'saved', signed: 1,
            file_name: 'RX_FULL.pdf', file_hash: 'abc123' },
          { id: 2, uuid: 'doc-sig', type: 'signature', status: 'saved', signed: 0,
            file_name: 'RX_SIGNATURE.pdf', file_hash: null },
        ],
      } } } },
      // 3) link do paciente + codigo de desbloqueio
      { status: 200, corpo: { data: { attributes: {
        link: 'https://memed.exemplo/r/abc', codigo: 'X7K2' } } } },
    ]);
    const p = createMemedProvider(CONFIG, { fetch: fetchFalso, clock: relogio });

    const r = await p.fetchPrescription(
      { ...CTX, actorUserId: null },
      { providerPrescriptionId: '987', prescriberRef: PROFISSIONAL });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.providerPrescriptionId).toBe('987');
    expect(r.value.patientLinkUrl).toBe('https://memed.exemplo/r/abc');
    expect(r.value.validationCode).toBe('X7K2');
    expect(r.value.items).toHaveLength(1);
    expect(r.value.items[0]?.nome).toBe('Dipirona 500mg');
    expect(r.value.items[0]?.ehControlado).toBe(false);

    // A PROVA de assinatura. Sem isto o acervo guarda um PDF e nenhuma evidencia
    // de que ele foi assinado — e "assinado" nao se deduz da existencia do QR
    // Code, que existe tambem em receita que sera assinada a mao.
    expect(r.value.signed).toBe(true);
    expect(r.value.providerPrescriptionUuid).toBe('c0ffee00-0000-4000-8000-000000000001');
    expect(r.value.documents).toHaveLength(2);

    const completo = r.value.documents.find((d) => d.type === 'full');
    expect(completo?.signed).toBe(true);
    expect(completo?.fileHash).toBe('abc123');
    expect(completo?.fileName).toBe('RX_FULL.pdf');

    // O artefato de assinatura vem como documento proprio, com signed=0 no
    // payload da Memed — e o continente da assinatura, nao um PDF assinado.
    expect(r.value.documents.find((d) => d.type === 'signature')?.signed).toBe(false);

    expect(new URL(chamadas[1]!.url).pathname).toBe('/v1/prescricoes/987');
    expect(new URL(chamadas[2]!.url).pathname)
      .toBe('/v1/prescricoes/987/get-digital-prescription-link');
  });

  it('receita sem assinatura devolve signed=false, e nao um palpite', async () => {
    const exp = Math.floor(AGORA_MS / 1000) + 3600;
    const { fetchFalso } = transporte([
      { status: 200, corpo: { data: { attributes: { token: jwtQueExpiraEm(exp) } } } },
      { status: 200, corpo: { data: { id: '988', attributes: {
        created_at: '2026-08-09 09:15:00',
        // `signed` ausente do payload: tratar ausencia como "assinada" seria
        // arquivar como prova algo que ninguem afirmou.
        medicamentos: [],
      } } } },
      { status: 200, corpo: { data: { attributes: { link: 'x', codigo: 'y' } } } },
    ]);
    const p = createMemedProvider(CONFIG, { fetch: fetchFalso, clock: relogio });

    const r = await p.fetchPrescription(CTX, {
      providerPrescriptionId: '988', prescriberRef: PROFISSIONAL });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.signed).toBe(false);
    expect(r.value.documents).toHaveLength(0);
  });

  it('declara safety por metodo — e o que o reconciliador consulta', () => {
    const { fetchFalso } = transporte([{ status: 200, corpo: {} }]);
    const p = createMemedProvider(CONFIG, { fetch: fetchFalso, clock: relogio });
    expect(p.safety['openPrescriberSession']).toBe('idempotent');
    expect(p.safety['fetchPrescription']).toBe('safe');
    expect(p.safety['fetchSignedArtifact']).toBe('safe');
    expect(p.capabilities.has('residency:br')).toBe(true);
  });
});
