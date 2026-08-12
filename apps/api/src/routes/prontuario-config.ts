import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

function erroDominio(kind: string, status: number): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind });
}

/**
 * A configuração de prontuário do tenant: quais seções e campos existem.
 *
 * O tenant nasce VAZIO de propósito. Não há template padrão instalado no
 * cadastro porque um prontuário pré-preenchido com campos que a clínica não usa
 * é pior que um vazio: o médico aprende a ignorar campos, e campo ignorado é
 * campo que um dia recebe dado errado.
 */

interface CampoDoTemplate {
  code: string;
  label: string;
  kind: string;
  options?: string[];
  observation_code?: string;
  unit?: string;
  source?: string;
  components?: { observation_code: string; label: string; unit?: string }[];
}
interface SecaoDoTemplate {
  code: string;
  label: string;
  fields: CampoDoTemplate[];
}

export async function prontuarioConfigRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/configuracoes/prontuario', {
    schema: {
      response: {
        200: z.object({
          secoes: z.array(z.object({
            sectionId: z.string().uuid(),
            code: z.string(),
            label: z.string(),
            campos: z.array(z.object({
              fieldId: z.string().uuid(),
              code: z.string(),
              label: z.string(),
              kind: z.string(),
              generation: z.number().int(),
              required: z.boolean(),
              unit: z.string().nullable(),
              options: z.array(z.string()).nullable(),
              refSource: z.string().nullable(),
              // Sem isto, peso e altura nao viram clin.observation e nao existe
              // serie numerica nenhuma — nem grafico, nem relatorio por variavel.
              observationCode: z.string().nullable(),
              // Campo composto sem seus componentes vira caixa de texto onde o
              // medico digita "12x8": sem serie numerica, sem grafico, sem
              // alerta. Os componentes SAO o campo.
              componentes: z.array(z.object({
                ordinal: z.number().int(),
                label: z.string(),
                unit: z.string().nullable(),
                observationCode: z.string(),
              })),
            })),
          })),
        }),
      },
    },
    // Sob encounter.read, e nao sob record.template.write: a tela de atendimento
    // PRECISA desta lista para saber em qual fieldId gravar o que o medico
    // escreveu. Exigir permissao de configurar para poder atender seria trancar
    // a porta pela qual todo mundo entra.
  }, rota('encounter.read', async (tx) => {
    const { rows } = await tx.query<{
      section_id: string; secao_code: string; secao_label: string;
      field_id: string | null; campo_code: string | null; campo_label: string | null;
      kind: string | null; generation: number | null; required: boolean | null;
      unit: string | null; options: string[] | null; ref_source: string | null;
      observation_code: string | null;
      secao_ordinal: number; campo_ordinal: number | null;
      componentes: { ordinal: number; label: string; unit: string | null;
                     observationCode: string }[] | null;
    }>(
      `SELECT s.id AS section_id, s.code AS secao_code, s.label AS secao_label,
              s.ordinal AS secao_ordinal,
              f.id AS field_id, f.code AS campo_code, f.label AS campo_label,
              f.kind::text AS kind, f.generation, f.required, f.unit, f.options,
              f.ref_source, f.observation_code, f.ordinal AS campo_ordinal,
              (SELECT jsonb_agg(jsonb_build_object(
                        'ordinal', k.ordinal, 'label', k.label,
                        'unit', k.unit, 'observationCode', k.observation_code)
                      ORDER BY k.ordinal)
                 FROM clin.record_field_component k
                WHERE (k.tenant_id, k.field_id) = (f.tenant_id, f.id)) AS componentes
         FROM clin.record_section s
         -- Layout DO PROFISSIONAL que esta pedindo, quando existir.
         --
         -- Cada medico arruma o proprio prontuario: ordem das secoes, o que
         -- esconde, o que deixa recolhido. Sem este LEFT JOIN, a ordem seria a
         -- da clinica para todo mundo — e o ortopedista veria "antecedentes
         -- ginecologicos" no topo em toda consulta.
         --
         -- LEFT JOIN e não INNER: quem nunca mexeu no layout cai na ordem da
         -- clínica, que é o padrão correto. INNER esconderia o prontuário
         -- inteiro de quem nunca abriu a configuração.
         LEFT JOIN clin.record_layout_item li
                ON (li.tenant_id, li.section_id) = (s.tenant_id, s.id)
               AND li.professional_id = app.current_professional_id()
         LEFT JOIN clin.record_field f
                ON (f.tenant_id, f.section_id) = (s.tenant_id, s.id)
               AND f.archived_at IS NULL
        WHERE s.archived_at IS NULL
          -- visible=false suma da ficha; ausência de linha não esconde nada.
          AND coalesce(li.visible, true)
        ORDER BY coalesce(li.ordinal, s.ordinal), s.ordinal, f.ordinal`);

    const porSecao = new Map<string, {
      sectionId: string; code: string; label: string;
      campos: { fieldId: string; code: string; label: string; kind: string;
                generation: number; required: boolean; unit: string | null;
                options: string[] | null; refSource: string | null;
                observationCode: string | null;
                componentes: { ordinal: number; label: string; unit: string | null;
                               observationCode: string }[] }[];
    }>();
    for (const x of rows) {
      let s = porSecao.get(x.section_id);
      if (s === undefined) {
        s = { sectionId: x.section_id, code: x.secao_code, label: x.secao_label,
              campos: [] };
        porSecao.set(x.section_id, s);
      }
      // LEFT JOIN: secao sem campo vivo devolve uma linha com field_id nulo.
      if (x.field_id !== null && x.campo_code !== null) {
        s.campos.push({
          fieldId: x.field_id, code: x.campo_code, label: x.campo_label ?? '',
          kind: x.kind ?? '', generation: x.generation ?? 1,
          required: x.required ?? false, unit: x.unit, options: x.options,
          refSource: x.ref_source,
          observationCode: x.observation_code,
          componentes: x.componentes ?? [],
        });
      }
    }
    return { secoes: [...porSecao.values()] };
  }));

  r.post('/v1/configuracoes/prontuario/instanciar', {
    schema: {
      body: z.object({ templateCode: z.string().min(1) }),
      response: {
        201: z.object({
          templateVersion: z.number().int(),
          criadas: z.number().int(),
          jaExistiam: z.number().int(),
        }),
      },
    },
  }, rota('record.template.write', async (tx, _ctx, req, reply) => {
    const b = req.body as { templateCode: string };

    const { rows: tpl } = await tx.query<{
      id: string; version: number; spec: { sections: SecaoDoTemplate[] };
    }>(
      `SELECT id, version, spec FROM ref.record_template
        WHERE code = $1 AND is_current`,
      [b.templateCode]);
    const t = tpl[0];
    if (t === undefined) erroDominio('template_desconhecido', 422);

    // Quais codes de seção já existem VIVOS. O índice único parcial
    // ux_record_section_viva impede duplicata, e um 23505 aqui viraria "erro ao
    // salvar" para quem só clicou duas vezes no mesmo botão.
    const { rows: existentes } = await tx.query<{ code: string }>(
      `SELECT code FROM clin.record_section WHERE archived_at IS NULL`);
    const jaTem = new Set(existentes.map((x) => x.code));

    let criadas = 0;
    let jaExistiam = 0;
    let ordinalSecao = jaTem.size;

    for (const secao of t.spec.sections) {
      if (jaTem.has(secao.code)) { jaExistiam += 1; continue; }
      const sectionId = uuidv7();
      await tx.query(
        `INSERT INTO clin.record_section
           (id, template_id, template_version, code, label, ordinal)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [sectionId, t.id, t.version, secao.code, secao.label, ordinalSecao]);
      ordinalSecao += 1;
      criadas += 1;

      for (const [i, campo] of secao.fields.entries()) {
        const fieldId = uuidv7();
        await tx.query(
          // required e is_reportable sao AMBOS false e ambos literais. Deixar um
          // deles como parametro ja custou um deslocamento silencioso de toda a
          // lista: o banco aceita o tipo errado quando os vizinhos sao text.
          // is_reportable false porque promover para clin.observation e decisao
          // de quem configura, nao efeito colateral de instalar um template.
          `INSERT INTO clin.record_field
             (id, section_id, code, label, kind, required, is_reportable,
              observation_code, unit, options, ref_source, ordinal)
           VALUES ($1,$2,$3,$4,$5::clin.field_kind,false,false,
                   $6,$7,$8::jsonb,$9,$10)`,
          [fieldId, sectionId, campo.code, campo.label, campo.kind,
           campo.observation_code ?? null,
           campo.unit ?? null,
           campo.options === undefined ? null : JSON.stringify(campo.options),
           campo.source ?? null,
           i]);

        // Componente de campo composto conta a partir de 1 (CHECK ordinal >= 1):
        // é o que o médico vê como "1ª e 2ª leitura da pressão", não índice de
        // array. O campo em si usa a base 0 do próprio ordinal, e as duas bases
        // convivem porque uma é de apresentação e a outra é de ordenação.
        for (const [j, c] of (campo.components ?? []).entries()) {
          await tx.query(
            `INSERT INTO clin.record_field_component
               (id, field_id, ordinal, observation_code, label, unit)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [uuidv7(), fieldId, j + 1, c.observation_code, c.label, c.unit ?? null]);
        }
      }
    }

    void reply.code(201);
    return { templateVersion: t.version, criadas, jaExistiam };
  }));

  /**
   * O layout do prontuário DO PROFISSIONAL que está pedindo.
   *
   * A tabela clin.record_layout_item existia no banco desde a Fase 1, com índice e
   * restrição de unicidade, e nunca teve uma linha: a tabela foi criada e o
   * recurso não. Na prática todo médico via as seções na ordem da clínica, e o
   * ortopedista abria "antecedentes ginecológicos" no topo em toda consulta.
   *
   * Devolve TODAS as seções, inclusive as ocultas — esta rota configura, não
   * renderiza. Quem esconde da ficha é `GET /v1/configuracoes/prontuario`.
   */
  r.get('/v1/configuracoes/prontuario/layout', {
    schema: {
      response: {
        200: z.object({
          itens: z.array(z.object({
            sectionId: z.string().uuid(),
            code: z.string(),
            label: z.string(),
            ordinal: z.number().int(),
            visible: z.boolean(),
            collapsed: z.boolean(),
            /** false = ainda esta no padrao da clinica. */
            personalizado: z.boolean(),
          })),
        }),
      },
    },
  }, rota('encounter.read', async (tx) => {
    const { rows } = await tx.query<{
      section_id: string; code: string; label: string; ordinal: number;
      visible: boolean; collapsed: boolean; personalizado: boolean;
    }>(
      `SELECT s.id AS section_id, s.code, s.label,
              coalesce(li.ordinal, s.ordinal) AS ordinal,
              coalesce(li.visible, true) AS visible,
              coalesce(li.collapsed, false) AS collapsed,
              (li.id IS NOT NULL) AS personalizado
         FROM clin.record_section s
         LEFT JOIN clin.record_layout_item li
                ON (li.tenant_id, li.section_id) = (s.tenant_id, s.id)
               AND li.professional_id = app.current_professional_id()
        WHERE s.archived_at IS NULL
        ORDER BY coalesce(li.ordinal, s.ordinal), s.ordinal`);

    return {
      itens: rows.map((x) => ({
        sectionId: x.section_id, code: x.code, label: x.label,
        ordinal: x.ordinal, visible: x.visible, collapsed: x.collapsed,
        personalizado: x.personalizado,
      })),
    };
  }));

  r.put('/v1/configuracoes/prontuario/layout', {
    schema: {
      body: z.object({
        itens: z.array(z.object({
          sectionId: z.string().uuid(),
          ordinal: z.number().int().min(1).max(999),
          visible: z.boolean(),
          collapsed: z.boolean(),
          // Lista VAZIA e valida e significa "voltar ao padrao da clinica":
          // apaga a personalizacao e o medico volta a receber as mudancas que a
          // clinica fizer. Exigir min(1) obrigaria a inventar um DELETE so para
          // isso, ou a reenviar a ordem da clinica — que gravaria um layout
          // identico ao padrao e CONGELARIA o medico nele.
        })).max(100),
      }),
      response: { 200: z.object({ salvos: z.number().int() }) },
    },
    // encounter.read e nao uma permissao de configuracao: o layout e do
    // PROPRIO profissional e nao afeta mais ninguem. Exigir permissao de gestao
    // faria o medico pedir ao administrador para mover uma secao de lugar.
  }, rota('encounter.read', async (tx, _ctx, req) => {
    const b = req.body as { itens: { sectionId: string; ordinal: number;
                                     visible: boolean; collapsed: boolean }[] };

    const { rows: prof } = await tx.query<{ id: string | null }>(
      `SELECT app.current_professional_id()::text AS id`);
    const professionalId = prof[0]?.id;
    if (professionalId === null || professionalId === undefined) {
      // Recepcao e financeiro nao tem vinculo de profissional — e nao tem
      // prontuario para arrumar. Recusar aqui e mais honesto que gravar um
      // layout orfao que ninguem veria.
      erroDominio('sem_vinculo_profissional', 422);
    }

    // Substitui o layout inteiro em vez de aplicar diferenca: a tela manda a
    // lista completa e ordenada, e um UPDATE por item deixaria buracos de
    // ordinal se algo falhasse no meio.
    await tx.query(
      `DELETE FROM clin.record_layout_item WHERE professional_id = $1`,
      [professionalId]);

    for (const i of b.itens) {
      await tx.query(
        `INSERT INTO clin.record_layout_item
           (id, professional_id, section_id, ordinal, visible, collapsed)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
        [professionalId, i.sectionId, i.ordinal, i.visible, i.collapsed]);
    }

    return { salvos: b.itens.length };
  }));
}
