import type { TxClient } from '@cadencia/db';

export interface PatientHit {
  readonly patientId: string;
  readonly displayName: string;      // nome social quando houver
  readonly legalName: string;        // nome civil, para conferencia de documento
  readonly hasSocialName: boolean;
  readonly birthDate: string | null;
  readonly cadastroStatus: 'preliminar' | 'completo';
  readonly phonePrimary: string | null;
}

export interface SearchInput {
  readonly termo: string;
  readonly limit?: number;
}

const SO_DIGITOS = /\D+/g;

/**
 * §6.4 — o combobox de busca de paciente e o componente mais importante do
 * produto. Duas estrategias, escolhidas pelo que foi digitado:
 *   - 3 ou mais digitos  -> `search_digits`, que guarda os grupos de digitos
 *     separados por espaco, um por identificador ou telefone
 *     ('11144477735 11987654321'). O casamento e por SUBSTRING, nao por prefixo:
 *     a recepcionista digita o telefone tao naturalmente quanto o CPF e o
 *     telefone quase nunca e o primeiro grupo;
 *   - qualquer outra coisa -> prefixo em `search_name`, que e
 *     unaccent(lower(coalesce(nome_social, full_name))) e por isso imune a caixa,
 *     a acento e ao locale.
 *
 * Quem limita a varredura, nos dois ramos, e o `tenant_id` a frente do indice
 * (ix_patient_busca / ix_patient_ordem, ambos liderados por tenant_id). Sem essa
 * lideranca a recepcionista de uma clinica pagaria o preco do crescimento da base
 * de todas as outras — medido: com 200 mil pacientes de OUTROS tenants na tabela,
 * o plano le as ~6 linhas do proprio tenant e nao faz Seq Scan.
 *
 * O LIKE em si NAO vira Index Cond e nem poderia: `textlike` nao e leakproof
 * (pg_proc.proleakproof = false), entao sob RLS ele nunca desce abaixo das quals
 * de seguranca da policy. Ele e filtro de heap sobre as linhas do tenant. Um
 * indice trigrama em search_digits foi medido e ficou com idx_scan = 0 por
 * exatamente esse motivo; nao existe, de proposito.
 *
 * A ordenacao final e por display_name COLLATE "pt-BR-x-icu" (§10 item 19).
 *
 * Ver o nome de um paciente ja e acesso a dado pessoal (§5.6): a busca emite
 * PATIENT_SEARCH pelo canal A, dentro da transacao de leitura. O evento nao
 * carrega o termo digitado — que pode ser o nome completo de alguem — e as
 * chaves de `meta` sao as da whitelist de audit.meta_keys_ok (0009).
 */
export async function searchPatients(tx: TxClient, input: SearchInput): Promise<PatientHit[]> {
  const limite = Math.min(Math.max(input.limit ?? 8, 1), 25);
  const termo = input.termo.trim();
  if (termo.length === 0) return [];

  const digitos = termo.replace(SO_DIGITOS, '');
  const porDigitos = digitos.length >= 3;

  await tx.query(
    `SELECT audit.log('PATIENT_SEARCH', 'clin', 'patient', NULL, 'sucesso',
                      jsonb_build_object('use_case', 'busca_paciente', 'kind', $1::text),
                      NULL)`,
    [porDigitos ? 'digitos' : 'nome']);

  const { rows } = await tx.query<{
    id: string; display_name: string; full_name: string; nome_social: string | null;
    birth_date: string | null; cadastro_status: 'preliminar' | 'completo';
    phone_primary: string | null;
  }>(
    porDigitos
      ? `SELECT p.id, p.display_name, p.full_name, p.nome_social,
                p.birth_date::text AS birth_date, p.cadastro_status, p.phone_primary
           FROM clin.patient p
          WHERE p.search_digits LIKE '%' || $1 || '%'
            AND p.inactivated_at IS NULL AND p.merged_into_id IS NULL
          ORDER BY p.display_name COLLATE "pt-BR-x-icu", p.id
          LIMIT $2`
      : `SELECT p.id, p.display_name, p.full_name, p.nome_social,
                p.birth_date::text AS birth_date, p.cadastro_status, p.phone_primary
           FROM clin.patient p
          WHERE p.search_name LIKE app.imm_unaccent(lower($1)) || '%'
            AND p.inactivated_at IS NULL AND p.merged_into_id IS NULL
          ORDER BY p.display_name COLLATE "pt-BR-x-icu", p.id
          LIMIT $2`,
    [porDigitos ? digitos : termo, limite]);

  return rows.map((r) => ({
    patientId: r.id,
    displayName: r.display_name,
    legalName: r.full_name,
    hasSocialName: r.nome_social !== null,
    birthDate: r.birth_date,
    cadastroStatus: r.cadastro_status,
    phonePrimary: r.phone_primary,
  }));
}
