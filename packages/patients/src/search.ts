import type { TxClient } from '@cadencia/db';

export interface PatientHit {
  readonly patientId: string;
  readonly displayName: string;      // nome social quando houver
  readonly legalName: string;        // nome civil, para conferência de documento
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
 * §6.4 — o combobox de busca de paciente é o componente mais importante do
 * produto. Duas estratégias, escolhidas pelo que foi digitado:
 *   - 3 ou mais dígitos  -> `search_digits`, que guarda os grupos de dígitos
 *     separados por espaço, um por identificador ou telefone
 *     ('11144477735 11987654321'). O casamento é por SUBSTRING, não por prefixo:
 *     a recepcionista digita o telefone tão naturalmente quanto o CPF e o
 *     telefone quase nunca é o primeiro grupo;
 *   - qualquer outra coisa -> prefixo em `search_name`, que é
 *     unaccent(lower(coalesce(nome_social, full_name))) e por isso imune a caixa,
 *     a acento e ao locale.
 *
 * Quem limita a varredura, nos dois ramos, é o `tenant_id` a frente do índice
 * (ix_patient_busca / ix_patient_ordem, ambos liderados por tenant_id). Sem essa
 * liderança a recepcionista de uma clínica pagaria o preço do crescimento da base
 * de todas as outras — medido: com 200 mil pacientes de OUTROS tenants na tabela,
 * o plano lê as ~6 linhas do próprio tenant e não faz Seq Scan.
 *
 * O LIKE em si NÃO vira Index Cond e nem poderia: `textlike` não é leakproof
 * (pg_proc.proleakproof = false), então sob RLS ele nunca desce abaixo das quals
 * de segurança da policy. Ele é filtro de heap sobre as linhas do tenant. Um
 * índice trigrama em search_digits foi medido e ficou com idx_scan = 0 por
 * exatamente esse motivo; não existe, de propósito.
 *
 * A ordenação final é por display_name COLLATE "pt-BR-x-icu" (§10 item 19).
 *
 * Ver o nome de um paciente já é acesso a dado pessoal (§5.6): a busca emite
 * PATIENT_SEARCH pelo canal A, dentro da transação de leitura. O evento não
 * carrega o termo digitado — que pode ser o nome completo de alguém — e as
 * chaves de `meta` são as da whitelist de audit.meta_keys_ok (0009).
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
