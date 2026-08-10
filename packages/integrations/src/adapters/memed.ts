import { createHash } from 'node:crypto';
import { isoFromMs, systemClock } from '@cadencia/kernel';
import {
  asRfc3339, failure, success,
  type ProviderCtx, type ProviderResult, type Rfc3339,
} from '../contracts/common';
import type {
  PrescriberSession, PrescriptionDocument, PrescriptionItem,
  PrescriptionProvider, PrescriptionRecord,
} from '../contracts/prescription';

/**
 * §7.1 — adaptador Memed. É provedor EMBUTIDO, não cliente HTTP puro.
 *
 * A Memed NAO tem rota para criar prescricao por API: quem prescreve e o modulo
 * JS dela, dentro da nossa tela, e o retorno chega por evento de JavaScript. O
 * que este adaptador faz e (a) obter o token do prescritor, que e o que autoriza
 * aquele medico a abrir o modulo, e (b) buscar do lado servidor a VERDADE sobre
 * a prescricao que o browser apenas disse existir.
 *
 * Contratos verificados na documentacao oficial (doc.memed.com.br), nao de
 * memoria. `baseUrl` JA INCLUI o /v1 — e assim que a Memed publica os dois
 * ambientes (integrations.api.memed.com.br/v1 e api.memed.com.br/v1):
 *   GET  {base}/sinapse-prescricao/check-key?api-key&secret-key
 *   GET  {base}/sinapse-prescricao/usuarios/{cpf}?api-key&secret-key -> token atual
 *   POST {base}/sinapse-prescricao/usuarios?api-key&secret-key       -> cadastra
 *   GET  {base}/prescricoes/{id}?token
 *   GET  {base}/prescricoes/{id}/get-digital-prescription-link?token
 *   GET  {base}/prescricoes/{id}/url-document/full?token
 *
 * O corpo e o retorno seguem JSON:API, dai o Accept `application/vnd.api+json`.
 *
 * DELETE existe nas duas familias e NAO e usado aqui, em nenhuma hipotese: a
 * propria Memed documenta que apagar o prescritor leva junto o historico dele.
 * Um adaptador que nunca chama DELETE nao apaga acervo clinico por engano.
 */

export interface MemedConfig {
  readonly baseUrl: string;
  /** URL do modulo JS que a tela carrega. Nao e a mesma origem da API. */
  readonly scriptUrl: string;
  readonly apiKey: string;
  readonly secretKey: string;
}

export interface MemedDeps {
  readonly fetch?: typeof globalThis.fetch;
  readonly clock?: { nowMs(): number };
}

interface RespostaUsuario {
  data?: { attributes?: { token?: string } };
}

interface RespostaPrescricao {
  data?: {
    id?: string;
    attributes?: {
      uuid?: string;
      signed?: string | number | boolean;
      documents?: Array<{
        id?: string | number;
        uuid?: string;
        type?: string;
        status?: string;
        signed?: string | number | boolean;
        file_name?: string;
        file_hash?: string | null;
      }>;
      created_at?: string;
      medicamentos?: Array<{
        nome?: string;
        principio_ativo?: string;
        concentracao?: string;
        forma?: string;
        quantidade?: string;
        posologia?: string;
        controle_especial?: string | number | boolean;
      }>;
      cid?: string;
      categoria?: string;
    };
  };
}

interface RespostaLink {
  data?: { attributes?: { link?: string; codigo?: string } };
}

/**
 * O `exp` do JWT e a UNICA fonte honesta de validade do token. A documentacao
 * avisa que o token e dinamico e que cachear como fixo e o erro classico; supor
 * um prazo nosso seria a mesma aposta com outro nome.
 */
function expiraEm(jwt: string): number | null {
  const partes = jwt.split('.');
  if (partes.length !== 3 || partes[1] === undefined) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(partes[1], 'base64url').toString('utf8')) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/** "Helena Vasques" -> nome "Helena", sobrenome "Vasques". */
function partirNome(completo: string): { nome: string; sobrenome: string } {
  const partes = completo.trim().split(/\s+/);
  if (partes.length <= 1) return { nome: completo.trim(), sobrenome: '' };
  return { nome: partes[0] ?? '', sobrenome: partes.slice(1).join(' ') };
}

/**
 * A Memed devolve booleanos como 0/1 em varios campos (`signed`,
 * `controle_especial`). Ler isso com truthiness de JavaScript aceitaria a
 * string '0' como verdadeira — e '0' e exatamente o que ela manda para "nao".
 */
function ehVerdade(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 'true';
}

export function createMemedProvider(
  config: MemedConfig, deps: MemedDeps = {},
): PrescriptionProvider {
  const http = deps.fetch ?? globalThis.fetch;
  const clock = deps.clock ?? systemClock;
  const base = config.baseUrl.replace(/\/+$/, '');

  function agora(): Rfc3339 {
    return asRfc3339(isoFromMs(clock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
  }

  function comChaves(caminho: string): string {
    const u = new URL(`${base}${caminho}`);
    u.searchParams.set('api-key', config.apiKey);
    u.searchParams.set('secret-key', config.secretKey);
    return u.toString();
  }

  function comToken(caminho: string, token: string): string {
    const u = new URL(`${base}${caminho}`);
    u.searchParams.set('token', token);
    return u.toString();
  }

  /**
   * Um unico ponto de traducao de falha. `unavailable` e o UNICO erro que
   * autoriza retry automatico (isRetryable), entao 4xx nunca pode cair nele:
   * repetir um 422 e so gastar a janela do paciente.
   */
  async function chamar<T>(
    url: string, init: RequestInit, ctx: ProviderCtx,
  ): Promise<{ ok: true; corpo: T } | { ok: false; erro: ReturnType<typeof failure<never>> }> {
    const abortar = new AbortController();
    const relogio = setTimeout(() => abortar.abort(), ctx.deadlineMs);
    try {
      const r = await http(url, {
        ...init,
        signal: abortar.signal,
        headers: {
          'accept': 'application/vnd.api+json',
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...init.headers,
        },
      });

      if (!r.ok) {
        const corpo = await r.json().catch(() => ({})) as { errors?: Array<{ detail?: string }> };
        const detalhe = corpo.errors?.[0]?.detail ?? `HTTP ${r.status}`;
        if (r.status >= 500) {
          return { ok: false, erro: failure({
            kind: 'unavailable', retrySafe: true, detail: detalhe }) };
        }
        return { ok: false, erro: failure({
          kind: 'rejected', retrySafe: false, code: String(r.status), detail: detalhe }) };
      }
      return { ok: true, corpo: await r.json() as T };
    } catch (e) {
      // Aborto por deadline: o estado do lado da Memed e DESCONHECIDO. Nunca
      // retry automatico — quem decide e a reconciliacao, consultando.
      const abortou = (e as { name?: string }).name === 'AbortError';
      return { ok: false, erro: failure(abortou
        ? { kind: 'timeout', retrySafe: false, detail: `deadline ${ctx.deadlineMs}ms` }
        : { kind: 'unavailable', retrySafe: true, detail: (e as Error).message }) };
    } finally {
      clearTimeout(relogio);
    }
  }

  /**
   * Token ATUAL do prescritor. Consulta primeiro, cadastra so se nao existir.
   *
   * A ordem importa e nao e estilo: POST e "cadastrar", nao "garantir que
   * existe". Fazer POST a cada abertura de receita escreveria na conta de
   * PRODUCAO da clinica toda vez que um medico prescreve. E a documentacao e
   * explicita em que o token nao e estatico — ele vem da consulta.
   */
  async function tokenDoPrescritor(
    ctx: ProviderCtx,
    p: { fullName: string; cpf: string; council: 'CRM' | 'CRO'; number: string; uf: string },
  ): Promise<{ ok: true; token: string; exp: number | null } | { ok: false; erro: ReturnType<typeof failure<never>> }> {
    const existente = await chamar<RespostaUsuario>(
      comChaves(`/sinapse-prescricao/usuarios/${encodeURIComponent(p.cpf)}`),
      { method: 'GET' }, ctx);

    if (existente.ok) {
      const t = existente.corpo.data?.attributes?.token;
      if (typeof t === 'string' && t !== '') {
        return { ok: true, token: t, exp: expiraEm(t) };
      }
    }

    const { nome, sobrenome } = partirNome(p.fullName);
    const r = await chamar<RespostaUsuario>(
      comChaves('/sinapse-prescricao/usuarios'),
      {
        method: 'POST',
        body: JSON.stringify({
          data: {
            type: 'usuarios',
            attributes: {
              external_id: p.cpf,
              nome, sobrenome,
              cpf: p.cpf,
              board: {
                board_code: p.council,
                board_number: p.number,
                board_state: p.uf,
              },
            },
          },
        }),
      },
      ctx);

    if (!r.ok) return { ok: false, erro: r.erro };

    const token = r.corpo.data?.attributes?.token;
    if (typeof token !== 'string' || token === '') {
      return { ok: false, erro: failure({
        kind: 'rejected', retrySafe: false, code: 'sem_token',
        detail: 'resposta sem data.attributes.token' }) };
    }
    return { ok: true, token, exp: expiraEm(token) };
  }

  return {
    id: 'memed',
    // `residency:br` e declaracao, nao suposicao: a Memed opera no Brasil e o
    // runtime recusa integracao de IA/dado clinico que nao declare residencia.
    capabilities: new Set(['embedded', 'signed-artifact', 'residency:br']),
    safety: {
      openPrescriberSession: 'idempotent',
      fetchPrescription: 'safe',
      fetchSignedArtifact: 'safe',
    },

    async health() {
      const inicio = clock.nowMs();
      try {
        // check-key existe exatamente para isto: dizer se o par de chaves esta
        // funcional SEM criar, alterar nem apagar nada. Sondar a saude por uma
        // rota que escreve seria transformar o monitor em efeito colateral.
        const r = await http(comChaves('/sinapse-prescricao/check-key'), {
          headers: { accept: 'application/vnd.api+json' } });
        return { up: r.ok, latencyMs: clock.nowMs() - inicio, checkedAt: agora() };
      } catch {
        return { up: false, latencyMs: clock.nowMs() - inicio, checkedAt: agora() };
      }
    },

    async openPrescriberSession(ctx, i): Promise<ProviderResult<PrescriberSession>> {
      const t = await tokenDoPrescritor(ctx, i.professional);
      if (!t.ok) return t.erro as ProviderResult<PrescriberSession>;

      const agoraSeg = Math.floor(clock.nowMs() / 1000);
      if (t.exp !== null && t.exp <= agoraSeg) {
        // Entregar token vencido faz o modulo abrir e falhar DENTRO da consulta,
        // com o paciente na sala. Falhar aqui e barulhento e recuperavel.
        return failure({
          kind: 'rejected', retrySafe: false, code: 'token_vencido',
          detail: `token expirou em ${new Date(t.exp * 1000).toISOString()}` });
      }

      const expiresAt = asRfc3339(isoFromMs(
        (t.exp ?? agoraSeg + 3600) * 1000)) ?? agora();

      return success<PrescriberSession>({
        mode: 'embedded',
        scriptUrl: config.scriptUrl,
        token: t.token,
        expiresAt,
        // O modulo JS recebe o paciente por aqui. Sem CPF quando nao houver:
        // recem-nascido e paciente sem documento existem (§10 item 9).
        patientPayload: {
          nome: i.patient.fullName,
          ...(i.patient.cpf === undefined ? {} : { cpf: i.patient.cpf }),
          ...(i.patient.birthDate === undefined ? {} : { data_nascimento: i.patient.birthDate }),
          ...(i.patient.phone === undefined ? {} : { telefone: i.patient.phone }),
        },
        correlationId: ctx.idempotencyKey,
      }, `memed:usuario:${i.professional.cpf}`);
    },

    async fetchPrescription(ctx, i): Promise<ProviderResult<PrescriptionRecord>> {
      const t = await tokenDoPrescritor(ctx, {
        fullName: i.prescriberRef?.fullName ?? '',
        cpf: i.prescriberRef?.cpf ?? '',
        council: i.prescriberRef?.council ?? 'CRM',
        number: i.prescriberRef?.number ?? '',
        uf: i.prescriberRef?.uf ?? '',
      });
      if (!t.ok) return t.erro as ProviderResult<PrescriptionRecord>;

      const id = encodeURIComponent(i.providerPrescriptionId);

      const p = await chamar<RespostaPrescricao>(
        comToken(`/prescricoes/${id}`, t.token), { method: 'GET' }, ctx);
      if (!p.ok) return p.erro as ProviderResult<PrescriptionRecord>;

      const l = await chamar<RespostaLink>(
        comToken(`/prescricoes/${id}/get-digital-prescription-link`, t.token),
        { method: 'GET' }, ctx);
      if (!l.ok) return l.erro as ProviderResult<PrescriptionRecord>;

      const attrs = p.corpo.data?.attributes ?? {};
      const items: PrescriptionItem[] = (attrs.medicamentos ?? []).map((m) => ({
        nome: m.nome ?? '',
        principioAtivo: m.principio_ativo ?? null,
        concentracao: m.concentracao ?? null,
        forma: m.forma ?? null,
        quantidade: m.quantidade ?? null,
        posologia: m.posologia ?? '',
        ehControlado: ehVerdade(m.controle_especial),
      }));

      const criadoEm = attrs.created_at === undefined
        ? agora()
        : asRfc3339(new Date(attrs.created_at.replace(' ', 'T') + 'Z').toISOString()) ?? agora();

      const documents: PrescriptionDocument[] = (attrs.documents ?? []).map((d) => ({
        documentId: String(d.id ?? ''),
        uuid: d.uuid ?? '',
        type: d.type ?? '',
        status: d.status ?? '',
        signed: ehVerdade(d.signed),
        fileName: d.file_name ?? '',
        fileHash: d.file_hash ?? null,
      }));

      return success<PrescriptionRecord>({
        providerPrescriptionId: p.corpo.data?.id ?? i.providerPrescriptionId,
        providerPrescriptionUuid: attrs.uuid ?? null,
        createdAt: criadoEm,
        // Ausencia de `signed` no payload NAO vira `true`. Arquivar como prova
        // algo que o provedor nao afirmou seria a pior classe de erro possivel
        // num acervo com guarda de 20 anos.
        signed: ehVerdade(attrs.signed),
        documents,
        patientLinkUrl: l.corpo.data?.attributes?.link ?? '',
        validationCode: l.corpo.data?.attributes?.codigo ?? '',
        pdfUrl: `${base}/prescricoes/${id}/url-document/full`,
        items,
        structured: attrs.cid === undefined && attrs.categoria === undefined
          ? null
          : { cid: attrs.cid ?? null, categoria: attrs.categoria ?? null },
      }, `memed:prescricao:${i.providerPrescriptionId}`);
    },

    async fetchSignedArtifact(ctx, i) {
      const t = await tokenDoPrescritor(ctx, {
        fullName: i.prescriberRef?.fullName ?? '',
        cpf: i.prescriberRef?.cpf ?? '',
        council: i.prescriberRef?.council ?? 'CRM',
        number: i.prescriberRef?.number ?? '',
        uf: i.prescriberRef?.uf ?? '',
      });
      if (!t.ok) {
        return t.erro as ProviderResult<{ bytes: Uint8Array; sha256: string }>;
      }

      const id = encodeURIComponent(i.providerPrescriptionId);
      const abortar = new AbortController();
      const relogio = setTimeout(() => abortar.abort(), ctx.deadlineMs);
      try {
        const r = await http(
          comToken(`/prescricoes/${id}/url-document/full`, t.token),
          { signal: abortar.signal });
        if (!r.ok) {
          return failure({
            kind: r.status >= 500 ? 'unavailable' : 'rejected',
            retrySafe: r.status >= 500, code: String(r.status),
            detail: `HTTP ${r.status} ao baixar o artefato assinado`,
          } as Parameters<typeof failure>[0]);
        }
        const bytes = new Uint8Array(await r.arrayBuffer());
        // O sha256 e NOSSO, calculado sobre os bytes que guardamos. E o que
        // permite provar em 2046 que o PDF do acervo e o mesmo que a Memed
        // devolveu, mesmo que a Memed nao exista mais.
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        return success({ bytes, sha256 }, `memed:artefato:${i.providerPrescriptionId}`);
      } catch (e) {
        const abortou = (e as { name?: string }).name === 'AbortError';
        return failure(abortou
          ? { kind: 'timeout', retrySafe: false, detail: `deadline ${ctx.deadlineMs}ms` }
          : { kind: 'unavailable', retrySafe: true, detail: (e as Error).message });
      } finally {
        clearTimeout(relogio);
      }
    },
  };
}
