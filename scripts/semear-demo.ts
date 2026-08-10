/**
 * Semente de DEMONSTRACAO.
 *
 * Cria um tenant completo e verossimil para mostrar o produto funcionando:
 * clinica, equipe com senha, pacientes, a semana inteira de agenda em varios
 * estados, e caixa com recibos emitidos. Tela vazia nao demonstra nada — um
 * produto de clinica so parece um produto de clinica quando a agenda esta cheia.
 *
 * Roda pela conexao ADMIN porque semear atravessa varios schemas e o papel
 * `jobs` nao tem GRANT em todos eles (BYPASSRLS ignora POLICY, nao ignora GRANT).
 *
 *   npx tsx --env-file=.env scripts/semear-demo.ts
 *
 * E idempotente pelo slug: rodar de novo apaga o tenant anterior e recria.
 */
import { Pool, type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '@cadencia/authn';
import { canonicalHash } from '@cadencia/kernel';

const SLUG = 'demo-aurora';
const SENHA = 'Cadencia@2026';
const FUSO = 'America/Sao_Paulo';

/** UUIDv7 sem importar o kernel: o script e ferramenta, nao codigo de produto. */
function uuid7(deslocamentoMs = 0): string {
  const ms = Date.now() + deslocamentoMs;
  const hex = ms.toString(16).padStart(12, '0');
  const resto = randomUUID().replace(/-/g, '').slice(12);
  const v7 = `${hex}7${resto.slice(1, 4)}${((parseInt(resto[4] ?? '0', 16) & 0x3) | 0x8).toString(16)}${resto.slice(5)}`;
  return `${v7.slice(0, 8)}-${v7.slice(8, 12)}-${v7.slice(12, 16)}-${v7.slice(16, 20)}-${v7.slice(20, 32)}`;
}

const NOMES = [
  'Ana Beatriz Carvalho', 'Bruno Almeida Rocha', 'Carla Menezes Lima',
  'Daniel Furtado Nunes', 'Eduarda Pires Tavares', 'Felipe Andrade Souza',
  'Gabriela Moreira Dias', 'Henrique Barros Melo', 'Isabela Fontes Ramos',
  'Joao Pedro Vasconcelos', 'Karina Duarte Siqueira', 'Leonardo Peixoto Braga',
  'Mariana Cordeiro Alves', 'Nathalia Guimaraes Reis', 'Otavio Bastos Cunha',
  'Patricia Rezende Aguiar', 'Rafael Ximenes Prado', 'Sabrina Teixeira Lopes',
  'Thiago Marinho Sales', 'Ursula Camargo Bittencourt', 'Vinicius Braga Falcao',
  'Yasmin Correia Pontes', 'Alvaro Nogueira Estrela', 'Beatriz Sampaio Quintela',
  'Caio Espindola Varela', 'Debora Machado Toledo', 'Elias Trindade Vasques',
  'Fernanda Ostrowski Reis', 'Gustavo Halim Bezerra', 'Helena Ipiranga Vidal',
  'Igor Jatoba Serrano', 'Juliana Klein Portela', 'Lucas Monteiro Ferraz',
  'Marcela Nobrega Assis', 'Nelson Quadros Ferreira', 'Olivia Rangel Simoes',
  'Paulo Salgado Verissimo', 'Renata Uchoa Belmonte', 'Sergio Valente Amaro',
  'Tatiana Wagner Coelho',
];

const PROCEDIMENTOS: readonly [string, string, string, number][] = [
  ['CONS', 'Consulta',            '#3b82f6', 30],
  ['RET',  'Retorno',             '#22c55e', 20],
  ['PROC', 'Procedimento',        '#f59e0b', 60],
  ['TELE', 'Teleconsulta',        '#a855f7', 30],
];

/**
 * Operadoras do demo. Fica no topo do modulo, e nao dentro de main(), porque a
 * agenda referencia o nome da operadora ANTES do bloco de convenios rodar — e
 * `const` nao sofre hoisting de valor.
 */
const OPERADORAS: readonly [string, string, string, string][] = [
  ['Unimed Regional',      '326305', '12345678000190', '4.01'],
  ['Bradesco Saude',       '005711', '92693118000160', '4.01'],
  ['SulAmerica Saude',     '006246', '01685053000156', '3.05'],
];

/** Contas fixas que toda clinica paga todo mes. */
const DESPESAS_MENSAIS: readonly [string, string, number][] = [
  ['Aluguel da unidade', 'Aluguel', 850000],
  ['Folha da equipe', 'Folha', 1240000],
  ['Material de consumo', 'Materiais', 187000],
];

/** De quem e cada conta fixa. */
const FORNECEDOR_DA_DESPESA: Record<string, string> = {
  'Aluguel da unidade': 'Imobiliaria Central',
  'Material de consumo': 'Distribuidora MedSupply',
  'Energia eletrica': 'Enel Distribuicao',
  'Internet e telefonia': 'Vivo Empresas',
};

const QUEIXAS = [
  'Cefaleia ha tres dias', 'Dor lombar apos esforco', 'Revisao anual',
  'Tosse persistente', 'Controle de pressao', 'Resultado de exames',
  'Dor abdominal', 'Ansiedade e insonia', 'Retorno pos-operatorio',
  'Alergia sazonal',
];

function adminPool(): Pool {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return new Pool({ connectionString: url, max: 1 });
}

/**
 * A janela do demo comeca TRES DIAS ANTES DE HOJE, e nao na segunda-feira.
 *
 * Ancorar na semana de calendario faz o demo abrir vazio sempre que a
 * apresentacao cair num sabado ou domingo — e "Sua agenda esta livre" e a pior
 * primeira tela possivel para um produto de clinica. Centrar em hoje garante
 * passado (atendido, faltou), presente (aguardando, atendendo) e futuro
 * (confirmado, agendado) em qualquer dia em que alguem abrir.
 */
function inicioDaJanela(): Date {
  const hoje = new Date();
  const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - 3);
  return d;
}

function iso(d: Date): string { return d.toISOString(); }
function dia(d: Date): string { return d.toISOString().slice(0, 10); }

/**
 * Refresca o tenant do demo e devolve os ids dele, ou `null` se ainda nao existe.
 *
 * NAO apaga o tenant. Nao pode: clin.encounter_version e append-only por
 * gatilho ("proibidos para qualquer papel", superusuario incluso), e dai a
 * cascata — versao segura o atendimento, atendimento segura o paciente,
 * paciente segura a clinica. Um script que conseguisse apagar tudo isso estaria
 * provando que a garantia central do produto nao existe.
 *
 * Entao a semente REUSA: apaga o que e refrescavel (agenda, caixa, conversas,
 * convenios) e preserva o acervo clinico e o cadastro. Para zerar de verdade:
 * `docker compose down -v && pnpm db:up && pnpm db:migrate`.
 */
async function refrescar(
  c: PoolClient,
): Promise<{ tenantId: string; clinicId: string } | null> {
  const { rows } = await c.query(`SELECT id FROM app.tenant WHERE slug = $1`, [SLUG]);
  const anterior = rows[0]?.id as string | undefined;
  if (anterior === undefined) return null;

  // Ordem importa: filhos antes dos pais.
  //
  // DUAS COISAS NAO SAO APAGADAS, e nao por esquecimento:
  //   - a trilha de auditoria, append-only por REVOKE;
  //   - clin.encounter e clin.encounter_version, append-only por gatilho — o
  //     banco recusa DELETE "para qualquer papel", superusuario incluso.
  //
  // Consequencia pratica: reexecutar a semente ACUMULA historico clinico em vez
  // de substitui-lo. Isso e o produto funcionando, nao um defeito do script:
  // prontuario finalizado nao se apaga, e um seed que conseguisse apagar estaria
  // provando que a garantia nao existe. Para comecar do zero de verdade:
  // `docker compose down -v && pnpm db:up && pnpm db:migrate`.
  const tabelas = [
    // Antes de `message` e `conversation`: a resposta de NPS aponta para as
    // duas. Sem esta linha, cada semeadura DOBRARIA as respostas e o indice
    // ficaria estavel por diluicao — o defeito mais dificil de notar, porque o
    // numero continua plausivel.
    'msg.nps_response',
    'msg.message', 'msg.conversation', 'msg.channel_identity',
    'inv.stock_movement', 'inv.stock_alert',
    'tiss.glosa', 'tiss.demonstrativo_item', 'tiss.demonstrativo',

    // SADT antes do lote: `lote_guia_sadt` aponta para os dois.
    'tiss.lote_guia_sadt', 'tiss.encounter_guia_sadt_item',
    'tiss.encounter_guia_sadt',
    'tiss.lote_guia', 'tiss.lote', 'tiss.encounter_guia_consulta',
    'tiss.paciente_convenio', 'tiss.operadora',
    'fin.receipt', 'fin.entry', 'inv.product', 'inv.supplier',
    'fin.supplier', 'fin.category', 'fin.payment_method',
    // Agendamento aponta para a serie: a serie sai depois dele.
    'sched.waitlist', 'sched.appointment', 'sched.recurrence',
  ];
  for (const t of tabelas) {
    await c.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [anterior]);
  }
  // As sessoes morrem para que a senha volte a ser exigida a cada semeadura.
  await c.query(`DELETE FROM id.session WHERE user_id IN
       (SELECT id FROM id."user" WHERE email LIKE '%@aurora.demo')`);

  const { rows: cl } = await c.query(
    `SELECT id FROM app.clinic WHERE tenant_id = $1 ORDER BY id LIMIT 1`,
    [anterior]);
  return { tenantId: anterior, clinicId: cl[0]?.id as string };
}

async function main(): Promise<void> {
  const pool = adminPool();
  const c = await pool.connect();

  try {
    await c.query('BEGIN');
    const existente = await refrescar(c);
    const reusando = existente !== null;

    const tenantId = existente?.tenantId ?? uuid7();
    const clinicId = existente?.clinicId ?? uuid7();

    if (!reusando) {
      await c.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, $2, 'Clinica Aurora Saude Ltda', '12ABC34501DE35')`,
        [tenantId, SLUG]);
      await c.query(
        `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
         VALUES ($1, $2, 'Aurora — Unidade Centro', '2077501', $3)`,
        [tenantId, clinicId, FUSO]);
    }

    // ── Equipe ──────────────────────────────────────────────────────────────
    const hash = await hashPassword(SENHA);
    const equipe = [
      // CPF preenchido para quem PRESCREVE: a Memed identifica o prescritor por
      // ele (external_id) e recusa a sessao inteira sem. Sao CPFs validos de
      // teste — digitos verificadores corretos, pessoa nenhuma.
      { nome: 'Dra. Helena Vasques',  email: 'helena@aurora.demo',   papel: 'admin_clinico', medica: true,  cpf: '39053344705' },
      { nome: 'Dr. Rafael Andrade',   email: 'rafael@aurora.demo',   papel: 'profissional',  medica: true,  cpf: '19100000000' },
      { nome: 'Juliana da Recepcao',  email: 'juliana@aurora.demo',  papel: 'recepcao',      medica: false, cpf: null },
      { nome: 'Marcos do Financeiro', email: 'marcos@aurora.demo',   papel: 'financeiro',    medica: false, cpf: null },
    ] as const;

    const profissionais: string[] = [];
    let primeiroUsuario = '';

    for (const [i, p] of equipe.entries()) {
      // Upsert por e-mail: reusando o tenant, a pessoa ja existe e o que se
      // quer e reafirmar a senha do demo, nao criar um segundo cadastro.
      const { rows: u } = await c.query(
        `INSERT INTO id."user" (id, email, full_name, cpf) VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name,
                                           cpf = EXCLUDED.cpf
         RETURNING id`,
        [uuid7(i), p.email, p.nome, p.cpf]);
      const userId = u[0].id as string;
      if (primeiroUsuario === '') primeiroUsuario = userId;

      await c.query(
        `INSERT INTO id.user_credential (user_id, password_hash) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
        [userId, hash]);
      await c.query(
        `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [tenantId, uuid7(i), userId, clinicId, p.papel]);

      if (p.medica) {
        const { rows: pr } = await c.query(
          `SELECT id FROM app.professional WHERE tenant_id = $1 AND user_id = $2`,
          [tenantId, userId]);
        let profId = pr[0]?.id as string | undefined;
        if (profId === undefined) {
          profId = uuid7(i);
          await c.query(
            `INSERT INTO app.professional
               (tenant_id, id, user_id, conselho_profissional, numero_conselho,
                uf_conselho, cbos)
             VALUES ($1, $2, $3, '06', $4, 'SP', '225125')`,
            [tenantId, profId, userId, `${100000 + i}`]);
        }
        profissionais.push(profId);
      }
    }

    // ── Procedimentos ───────────────────────────────────────────────────────
    const procedimentos: string[] = [];
    for (const [i, [codigo, nome, cor, duracao]] of PROCEDIMENTOS.entries()) {
      // Sem UNIQUE em (tenant_id, code): consulta antes de inserir.
      const { rows: ja } = await c.query(
        `SELECT id FROM sched.procedure WHERE tenant_id = $1 AND code = $2`,
        [tenantId, codigo]);
      if (ja.length > 0) { procedimentos.push(ja[0].id as string); continue; }
      const id = uuid7(i);
      await c.query(
        `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, id, codigo, nome, cor, duracao]);
      procedimentos.push(id);
    }

    // ── Pacientes ───────────────────────────────────────────────────────────
    const pacientes: string[] = [];
    const { rows: jaExistem } = await c.query(
      `SELECT id FROM clin.patient WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId]);
    if (jaExistem.length >= NOMES.length) {
      // Paciente nao se apaga (a cascata do prontuario impede), entao recriar
      // duplicaria a base a cada semeadura.
      for (const r of jaExistem) pacientes.push(r.id as string);

      // Reusar significa que ajustes de cadastro precisam ser UPDATE explicito:
      // os tres primeiros passam a fazer aniversario hoje, senao a secao de
      // aniversariantes do painel nunca aparece no demo.
      for (const [i, id] of pacientes.slice(0, 3).entries()) {
        await c.query(
          `UPDATE clin.patient
              SET birth_date = make_date($3::int,
                    extract(month FROM current_date)::int,
                    extract(day   FROM current_date)::int)
            WHERE tenant_id = $1 AND id = $2`,
          [tenantId, id, 1955 + i * 7]);
      }
    } else
    for (const [i, nome] of NOMES.entries()) {
      const id = uuid7(i);
      const cpf = String(10000000000 + i * 7654321).slice(0, 11);
      const nascimento = `19${55 + (i % 45)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`;
      await c.query(
        `INSERT INTO clin.patient
           (tenant_id, id, full_name, cadastro_status, birth_date,
            phone_primary, email, search_digits)
         VALUES ($1, $2, $3, 'completo', $4::date, $5, $6, $7)`,
        [tenantId, id, nome, nascimento,
         `119${String(80000000 + i * 137).slice(0, 8)}`,
         `${nome.split(' ')[0]?.toLowerCase()}${i}@exemplo.com.br`, cpf]);
      await c.query(
        `INSERT INTO clin.patient_identifier (tenant_id, id, patient_id, kind, value)
         VALUES ($1, $2, $3, 'CPF', $4)`,
        [tenantId, uuid7(i), id, cpf]);
      pacientes.push(id);
    }

    // ── Agenda da semana ────────────────────────────────────────────────────
    const inicio0 = inicioDaJanela();
    const hojeStr = dia(new Date());
    let n = 0;
    const agendamentos: { id: string; patientId: string; profId: string; status: string; quando: Date }[] = [];

    for (let d = 0; d < 7; d += 1) {
      const data = new Date(inicio0);
      data.setUTCDate(inicio0.getUTCDate() + d);
      const dataStr = dia(data);
      const passado = dataStr < hojeStr;
      const eHoje = dataStr === hojeStr;

      for (let slot = 0; slot < 8; slot += 1) {
        const profId = profissionais[slot % profissionais.length] ?? profissionais[0] ?? '';
        const procId = procedimentos[slot % procedimentos.length] ?? procedimentos[0] ?? '';
        const inicio = new Date(data);
        // 11h UTC = 8h em Sao Paulo. O horario do demo tem que parecer expediente.
        inicio.setUTCHours(11 + Math.floor(slot / 2), (slot % 2) * 30, 0, 0);
        const fim = new Date(inicio.getTime() + 30 * 60_000);

        // Estados verossimeis: passado ja atendido (com uma falta), hoje
        // espalhado pelo dia, futuro so agendado ou confirmado.
        const status = passado
          ? (slot === 5 ? 'faltou' : 'atendido')
          : eHoje
            ? (['atendido', 'atendido', 'aguardando', 'atendendo', 'confirmado',
                'confirmado', 'agendado', 'agendado'][slot] ?? 'agendado')
            : (slot % 3 === 0 ? 'confirmado' : 'agendado');

        const id = uuid7(n);
        const patientId = pacientes[n % pacientes.length] ?? pacientes[0] ?? '';
        // Dois em cada tres atendimentos sao de convenio: e a proporcao real de
        // uma clinica que fatura TISS, e o grafico de mix so informa se houver
        // mix. Todo mundo particular faz o grafico existir sem dizer nada.
        const operadora = n % 3 === 0 ? null
          : (OPERADORAS[n % OPERADORAS.length]?.[0] ?? null);
        // Duracao REALIZADA diferente da agendada: 30 min na grade, 22 a 52 na
        // vida. E exatamente essa diferenca que o painel existe para mostrar.
        const duracaoReal = 22 + ((n * 7) % 31);
        await c.query(
          `INSERT INTO sched.appointment
             (tenant_id, id, patient_id, professional_id, clinic_id, procedure_id,
              operadora_nome,
              starts_at, ends_at, appointment_date, status, primeira_vez, observacao,
              confirmed_at, arrived_at, started_at, finished_at, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$14,$7::timestamptz,$8::timestamptz,$9::date,
                   $10::sched.appointment_status, $11,$12,
                   CASE WHEN $10 IN ('confirmado','aguardando','atendendo','atendido')
                        THEN $7::timestamptz - interval '1 day' END,
                   CASE WHEN $10 IN ('aguardando','atendendo','atendido')
                        THEN $7::timestamptz END,
                   CASE WHEN $10 IN ('atendendo','atendido')
                        THEN $7::timestamptz END,
                   CASE WHEN $10 = 'atendido'
                        THEN $7::timestamptz + make_interval(mins => $15::int) END,
                   $13)`,
          [tenantId, id, patientId, profId, clinicId, procId,
           iso(inicio), iso(fim), dataStr, status,
           n % 4 === 0, QUEIXAS[n % QUEIXAS.length] ?? null, primeiroUsuario,
           operadora, duracaoReal]);

        agendamentos.push({ id, patientId, profId, status, quando: inicio });
        n += 1;
      }
    }

    // ── Caixa: um recibo por atendimento concluido ──────────────────────────
    const metodos = [
      ['pix', 'Pix'], ['cartao_credito', 'Cartao de credito'],
      ['dinheiro', 'Dinheiro'], ['cartao_debito', 'Cartao de debito'],
    ] as const;
    const metodoIds: string[] = [];
    for (const [i, [kind, nome]] of metodos.entries()) {
      const id = uuid7(i);
      await c.query(
        `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
         VALUES ($1, $2, $3::fin.payment_method_kind, $4)`,
        [tenantId, id, kind, nome]);
      metodoIds.push(id);
    }

    // Categorias: sem elas a visao geral nao tem "top categorias" e o caixa
    // mostra tudo como "Sem categoria".
    const CATEGORIAS: readonly [string, 'receita' | 'despesa'][] = [
      ['Consultas', 'receita'], ['Procedimentos', 'receita'], ['Convenios', 'receita'],
      ['Aluguel', 'despesa'], ['Folha', 'despesa'], ['Materiais', 'despesa'],
    ];
    const categoriaIds = new Map<string, string>();
    for (const [i, [nome, kind]] of CATEGORIAS.entries()) {
      const id = uuid7(i);
      await c.query(
        `INSERT INTO fin.category (tenant_id, id, name, kind)
         VALUES ($1, $2, $3, $4::fin.entry_kind)`, [tenantId, id, nome, kind]);
      categoriaIds.set(nome, id);
    }

    let numeroRecibo = 0;
    for (const [i, a] of agendamentos.filter((x) => x.status === 'atendido').entries()) {
      const entryId = uuid7(i);
      const valor = [18000, 25000, 32000, 45000][i % 4] ?? 25000;
      await c.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, category_id, patient_id, appointment_id,
            professional_id, clinic_id, description, amount_cents,
            payment_method_id, paid_at, status, idempotency_key)
         VALUES ($1,$2,'receita',$3,$4,$5,$6,$7,$8,$9,$10,$11,'pago',$12)`,
        [tenantId, entryId,
         categoriaIds.get(i % 3 === 0 ? 'Procedimentos' : 'Consultas'),
         a.patientId, a.id, a.profId, clinicId,
         'Atendimento particular', valor,
         metodoIds[i % metodoIds.length], iso(a.quando), `demo-${entryId}`]);

      numeroRecibo += 1;
      await c.query(
        // `issued_at` recebe a hora do ATENDIMENTO, nao o clock_timestamp() do
        // momento da semeadura. Sem isto os recibos saem todos com o mesmo
        // minuto e a tela de caixa denuncia dado sintetico na primeira olhada.
        `INSERT INTO fin.receipt (tenant_id, id, entry_id, receipt_number, issued_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz)`,
        [tenantId, uuid7(i), entryId, numeroRecibo, iso(a.quando)]);
    }
    await c.query(
      `INSERT INTO fin.receipt_counter (tenant_id, next_value) VALUES ($1, $2)
       ON CONFLICT (tenant_id) DO UPDATE SET next_value = EXCLUDED.next_value`,
      [tenantId, numeroRecibo + 1]);

    // ── Fornecedores e estoque ──────────────────────────────────────────────
    const FORNECEDORES: readonly [string, string][] = [
      ['Imobiliaria Central', 'Aluguel'],
      ['Distribuidora MedSupply', 'Materiais'],
      ['Enel Distribuicao', 'Materiais'],
      ['Vivo Empresas', 'Materiais'],
    ];
    // Duas tabelas de fornecedor, de proposito e nao por descuido: `fin.supplier`
    // e o credor de uma conta a pagar; `inv.supplier` e de quem se compra
    // insumo. O mesmo CNPJ pode ser os dois, mas as duas relacoes tem ciclo de
    // vida proprio — cancelar um contrato de aluguel nao apaga o historico de
    // compra de luva. Semeamos os dois lados com os mesmos nomes.
    const fornecedorIds = new Map<string, string>();
    const fornecedorEstoqueIds = new Map<string, string>();
    for (const [i, [nome]] of FORNECEDORES.entries()) {
      const idFin = uuid7(i);
      const idInv = uuid7(50 + i);
      await c.query(
        `INSERT INTO fin.supplier (tenant_id, id, name) VALUES ($1, $2, $3)`,
        [tenantId, idFin, nome]);
      await c.query(
        `INSERT INTO inv.supplier (tenant_id, id, name) VALUES ($1, $2, $3)`,
        [tenantId, idInv, nome]);
      fornecedorIds.set(nome, idFin);
      fornecedorEstoqueIds.set(nome, idInv);
    }

    // Dois itens ABAIXO do minimo de proposito: a tela de estoque so prova que
    // serve para alguma coisa quando existe algo para alertar.
    const PRODUTOS: readonly [string, string, string, number, number][] = [
      ['Luva de procedimento M', 'LUV-M',   'cx', 40, 12],
      ['Seringa 5ml',            'SER-5',   'un', 200, 340],
      ['Agulha 25x7',            'AGU-257', 'un', 200, 180],
      ['Algodao hidrofilo',      'ALG-500', 'cx', 20, 46],
      ['Gaze esteril',           'GAZ-EST', 'cx', 30, 8],
      ['Alcool 70%',             'ALC-70',  'ml', 10, 24],
      ['Mascara cirurgica',      'MSC-CIR', 'cx', 25, 60],
      ['Termometro digital',     'TER-DIG', 'un', 3, 7],
    ];
    for (const [i, [nome, sku, unidade, minimo, atual]] of PRODUTOS.entries()) {
      await c.query(
        `INSERT INTO inv.product
           (tenant_id, id, name, sku, unit, min_stock, current_stock, supplier_id)
         VALUES ($1,$2,$3,$4,$5::inv.unit_kind,$6,$7,$8)`,
        [tenantId, uuid7(i), nome, sku, unidade, minimo, atual,
         fornecedorEstoqueIds.get('Distribuidora MedSupply')]);
    }

    // ── Historico financeiro de 3 meses ─────────────────────────────────────
    // A agenda cobre 7 dias porque e o que a recepcao usa. O CAIXA precisa de
    // mais: sem historico, o grafico de receita contra despesa tem uma barra so
    // e o saldo do mes aparece negativo, porque um mes de aluguel e folha come
    // sete dias de consulta. A clinica existia antes do demo comecar.
    let historico = 0;
    // Vai ate ANTEONTEM (d > 2) e nao ate uma semana atras: parar em d=7 deixava
    // o mes corrente com poucos dias de receita contra o mes inteiro de aluguel
    // e folha, e a tela abria com saldo negativo por artefato de semeadura.
    for (let d = 90; d > 2; d -= 1) {
      const data = new Date();
      data.setUTCDate(data.getUTCDate() - d);
      const diaSemana = data.getUTCDay();
      if (diaSemana === 0 || diaSemana === 6) continue;   // clinica fecha

      const atendimentosNoDia = 6 + (d % 4);
      for (let k = 0; k < atendimentosNoDia; k += 1) {
        const quando = new Date(data);
        quando.setUTCHours(11 + (k % 8), (k % 2) * 30, 0, 0);
        const valor = [18000, 25000, 32000, 45000][(d + k) % 4] ?? 25000;
        await c.query(
          `INSERT INTO fin.entry
             (tenant_id, id, kind, category_id, patient_id, professional_id, clinic_id,
              description, amount_cents, payment_method_id, paid_at, status,
              idempotency_key)
           VALUES ($1,$2,'receita',$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,'pago',$11)`,
          [tenantId, uuid7(historico),
           categoriaIds.get(k % 3 === 0 ? 'Procedimentos' : 'Consultas'),
           pacientes[(d + k) % pacientes.length],
           profissionais[k % profissionais.length], clinicId,
           'Atendimento particular', valor,
           metodoIds[(d + k) % metodoIds.length], iso(quando), `hist-${uuid7(historico)}`]);
        historico += 1;
      }
    }

    // Despesas dos meses anteriores, para o grafico ter as duas series.
    for (let mes = 1; mes <= 3; mes += 1) {
      for (const [i, [descricao, categoria, valor]] of DESPESAS_MENSAIS.entries()) {
        const quando = new Date();
        quando.setUTCMonth(quando.getUTCMonth() - mes, 5);
        await c.query(
          `INSERT INTO fin.entry
             (tenant_id, id, kind, category_id, professional_id, clinic_id,
              description, amount_cents, payment_method_id, paid_at, status,
              idempotency_key)
           VALUES ($1,$2,'despesa',$3,$4,$5,$6,$7,$8,$9::timestamptz,'pago',$10)`,
          [tenantId, uuid7(mes * 10 + i), categoriaIds.get(categoria),
           profissionais[0], clinicId, descricao, valor, metodoIds[0],
           iso(quando), `histd-${uuid7(mes * 10 + i)}`]);
      }
    }

    // ── Despesas do mes e recebimentos em aberto ────────────────────────────
    // Um caixa so com receita paga nao parece um caixa de clinica: falta a
    // conta de aluguel, a folha, e o particular que prometeu pagar na semana
    // que vem. Sao essas tres coisas que a gestora procura quando abre a tela.
    const DESPESAS: readonly [string, string, number, number][] = [
      ['Aluguel da unidade', 'Aluguel', 850000, -5],
      ['Folha da equipe', 'Folha', 1240000, -4],
      ['Material de consumo', 'Materiais', 187000, -2],
      ['Energia eletrica', 'Materiais', 96000, 4],
      ['Internet e telefonia', 'Materiais', 41000, 8],
    ];
    for (const [i, [descricao, categoria, valor, dias]] of DESPESAS.entries()) {
      const pago = dias < 0;
      await c.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, category_id, professional_id, clinic_id,
            description, amount_cents, payment_method_id,
            paid_at, due_date, status, idempotency_key, supplier_id)
         VALUES ($1,$2,'despesa',$3,$4,$5,$6,$7,$8,
                 CASE WHEN $9 THEN clock_timestamp() + make_interval(days => $10::int) END,
                 (clock_timestamp() + make_interval(days => $10::int))::date,
                 CASE WHEN $9 THEN 'pago' ELSE 'pendente' END::fin.entry_status, $11, $12)`,
        [tenantId, uuid7(i), categoriaIds.get(categoria), profissionais[0], clinicId,
         descricao, valor, metodoIds[0], pago, dias, `desp-${uuid7(i)}`,
         fornecedorIds.get(FORNECEDOR_DA_DESPESA[descricao] ?? 'Distribuidora MedSupply')
           ?? null]);
    }

    const PENDENTES: readonly [number, number][] = [
      [45000, -12], [32000, -3], [28000, 2], [60000, 9],
    ];
    for (const [i, [valor, dias]] of PENDENTES.entries()) {
      await c.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, category_id, patient_id, professional_id, clinic_id,
            description, amount_cents, payment_method_id, due_date, status,
            idempotency_key)
         VALUES ($1,$2,'receita',$3,$4,$5,$6,$7,$8,$9,
                 (clock_timestamp() + make_interval(days => $10::int))::date,
                 'pendente',$11)`,
        [tenantId, uuid7(i), categoriaIds.get('Consultas'), pacientes[i + 5],
         profissionais[i % profissionais.length], clinicId,
         'Consulta a receber', valor, metodoIds[1], dias, `pend-${uuid7(i)}`]);
    }

    // ── Configuracao do prontuario ──────────────────────────────────────────
    // Sem secao e campo instanciados nao existe onde gravar a evolucao, e a tela
    // de atendimento finalizaria uma versao VAZIA. O filtro por tenant_id e
    // obrigatorio: aqui rodamos como dono do banco, fora da RLS, e sem ele o
    // EXISTS enxerga as secoes de TODOS os tenants e pula tudo em silencio.
    await c.query(
      `DO $seed$
       DECLARE tpl record; sec jsonb; f jsonb; k jsonb; sid uuid; fid uuid;
               so int := 0; fo int; ko int;
       BEGIN
         SELECT * INTO tpl FROM ref.record_template
          WHERE code = 'evolucao_livre' AND is_current;
         FOR sec IN SELECT * FROM jsonb_array_elements(tpl.spec->'sections') LOOP
           CONTINUE WHEN EXISTS (SELECT 1 FROM clin.record_section
                                  WHERE tenant_id = '${tenantId}'::uuid
                                    AND code = sec->>'code' AND archived_at IS NULL);
           sid := gen_random_uuid(); fo := 0;
           INSERT INTO clin.record_section
             (tenant_id, id, template_id, template_version, code, label, ordinal)
           VALUES ('${tenantId}'::uuid, sid, tpl.id, tpl.version,
                   sec->>'code', sec->>'label', so);
           so := so + 1;
           FOR f IN SELECT * FROM jsonb_array_elements(sec->'fields') LOOP
             fid := gen_random_uuid();
             INSERT INTO clin.record_field
               (tenant_id, id, section_id, code, label, kind, required,
                is_reportable, observation_code, unit, options, ref_source, ordinal)
             VALUES ('${tenantId}'::uuid, fid, sid, f->>'code',
                     f->>'label', (f->>'kind')::clin.field_kind, false, false,
                     f->>'observation_code', f->>'unit', f->'options',
                     f->>'source', fo);
             fo := fo + 1;
             -- Componentes do campo COMPOSTO. Sem eles a pressao arterial vira
             -- um fieldset vazio na tela: o campo existe, ninguem consegue
             -- preencher, e nao ha serie numerica de PA nenhuma.
             ko := 1;
             FOR k IN SELECT * FROM jsonb_array_elements(coalesce(f->'components','[]'::jsonb)) LOOP
               INSERT INTO clin.record_field_component
                 (tenant_id, id, field_id, ordinal, observation_code, label, unit)
               VALUES ('${tenantId}'::uuid, gen_random_uuid(), fid, ko,
                       k->>'observation_code', k->>'label', k->>'unit');
               ko := ko + 1;
             END LOOP;
           END LOOP;
         END LOOP;
       END $seed$;`);

    // ── Atendimentos clinicos finalizados ───────────────────────────────────
    // Vao pela FUNCAO DE PRODUCAO clin.finalize_encounter, e nao por INSERT
    // direto em clin.encounter_version. A versao clinica carrega cadeia de hash
    // (§3.5); forjar uma linha aqui produziria acervo com cadeia invalida — e o
    // ensaio de restauracao existe exatamente para pegar isso.
    await c.query(
      `SELECT set_config('app.tenant_id', $1, TRUE),
              set_config('app.user_id', $2, TRUE),
              set_config('app.clinic_id', $3, TRUE),
              set_config('app.actor_kind', 'user', TRUE),
              set_config('app.request_id', '', TRUE)`,
      [tenantId, primeiroUsuario, clinicId]);

    const versoes: { encounterId: string; versionId: string }[] = [];
    for (const [i, a] of agendamentos.filter((x) => x.status === 'atendido').entries()) {
      const encounterId = uuid7(i);
      await c.query(
        `INSERT INTO clin.encounter
           (tenant_id, id, patient_id, professional_id, clinic_id, appointment_id,
            occurred_at, occurred_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,
                 app.local_date($7::timestamptz, $8))`,
        [tenantId, encounterId, a.patientId, a.profId, clinicId, a.id,
         iso(a.quando), FUSO]);

      const payload = {
        queixa: QUEIXAS[i % QUEIXAS.length] ?? 'Consulta de rotina',
        conduta: 'Orientacoes gerais e retorno em 30 dias',
        cid: ['J06.9', 'M54.5', 'I10', 'K29.7'][i % 4] ?? 'Z00.0',
      };
      const { rows: v } = await c.query(
        // A funcao devolve TABLE(version_id, version_no): chamar no FROM em vez
        // de no SELECT, senao o retorno vem como registro composto.
        `SELECT version_id FROM clin.finalize_encounter(
           $1, 'original', $2::jsonb, $3, 'jcs-1', NULL, NULL, false)`,
        [encounterId, JSON.stringify(payload), canonicalHash(payload)]);
      versoes.push({ encounterId, versionId: v[0].version_id as string });
    }

    // ── Atendimentos EM ANDAMENTO (rascunho) ────────────────────────────────
    //
    // Sem rascunho a tela `/atendimento/[id]` nao abre: ela recusa atendimento
    // ja selado, e com razao — registro finalizado nao se edita. A demonstracao
    // ficava com 46 atendimentos e nenhum que desse para abrir.
    //
    // Aqui NAO se chama `clin.finalize_encounter`: o encounter nasce e fica em
    // rascunho, que e o estado em que o medico digita.
    const rascunhos: string[] = [];
    const emAndamento = agendamentos
      .filter((x) => x.status === 'atendendo' || x.status === 'aguardando');
    for (const [i, a] of emAndamento.entries()) {
      const encounterId = uuid7(500 + i);
      await c.query(
        `INSERT INTO clin.encounter
           (tenant_id, id, patient_id, professional_id, clinic_id, appointment_id,
            occurred_at, occurred_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,
                 app.local_date($7::timestamptz, $8))`,
        [tenantId, encounterId, a.patientId, a.profId, clinicId, a.id,
         iso(a.quando), FUSO]);
      // Rascunho com texto ja digitado: abrir uma tela em branco nao mostra o
      // autosave nem a recuperacao do que estava escrito.
      await c.query(
        `INSERT INTO clin.encounter_draft (tenant_id, encounter_id, rev, payload, updated_by)
         VALUES ($1,$2,1,$3::jsonb,$4)
         ON CONFLICT DO NOTHING`,
        [tenantId, encounterId, JSON.stringify({
          doc: { type: 'doc', content: [{ type: 'paragraph', content: [
            { type: 'text', text: 'Paciente refere dor lombar ha cinco dias.' }] }] },
        }), primeiroUsuario]);
      rascunhos.push(encounterId);
    }

    // ── Convenios (TISS) ────────────────────────────────────────────────────
    // O ciclo inteiro em miniatura: guia emitida, lote enviado, demonstrativo
    // importado e glosa aberta. E o percurso onde o produto se diferencia — a
    // maioria dos concorrentes para na geracao do lote e nao ajuda no recurso.
    const operadoraIds: string[] = [];
    for (const [i, [nome, ans, cnpj, versao]] of OPERADORAS.entries()) {
      const id = uuid7(i);
      await c.query(
        `INSERT INTO tiss.operadora
           (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version,
            transport_mode, telefone, email, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'arquivo',$7,$8,$9)`,
        [tenantId, id, ans, nome, cnpj, versao,
         `11${3000 + i}${4000 + i}`, `faturamento@${nome.split(' ')[0]?.toLowerCase()}.com.br`,
         primeiroUsuario]);
      operadoraIds.push(id);
    }

    // Carteirinhas: e o que faz "totalPacientes" da tela de operadoras existir.
    for (let i = 0; i < 18; i += 1) {
      await c.query(
        `INSERT INTO tiss.paciente_convenio
           (tenant_id, id, patient_id, operadora_id, numero_carteira, nome_plano,
            tipo_beneficiario, created_by)
         VALUES ($1,$2,$3,$4,$5,'Plano Empresarial','T',$6)`,
        [tenantId, uuid7(i), pacientes[i], operadoraIds[i % operadoraIds.length],
         `${100000000 + i * 137}`, primeiroUsuario]);
    }

    // ── Faturamento do atendimento ──────────────────────────────────────────
    //
    // `clin.encounter_billing` e o que diz que aquele atendimento foi por
    // CONVENIO. Sem ela o produto trata tudo como particular: a guia de consulta
    // nao e projetada, o painel de SP/SADT abre dizendo "particular" e a cadeia
    // TISS inteira fica sem materia-prima.
    //
    // Metade dos atendimentos leva convenio e metade fica particular — clinica
    // real tem os dois, e uma demonstracao so com convenio esconde o caminho do
    // recibo.
    for (const [i, v] of versoes.entries()) {
      if (i % 2 === 1) continue;
      const op = OPERADORAS[i % OPERADORAS.length]!;
      await c.query(
        `INSERT INTO clin.encounter_billing
           (tenant_id, id, encounter_id, operadora_nome, registro_ans,
            numero_carteira, atendimento_rn, cnes, cnpj_contratado,
            conselho_profissional, numero_conselho, uf_conselho, cbos,
            indicacao_acidente, regime_atendimento, tipo_consulta,
            data_atendimento, codigo_tabela, codigo_procedimento, valor_centavos,
            created_by)
         SELECT $1, $2, $3, $4, $5,
                $6, false, c.cnes, '11ABC22334DE55',
                '06', '123456', 'SP', '225125',
                '9', '01', '1',
                e.occurred_date, '22', '10101012', 15000, $7
           FROM clin.encounter e
           JOIN app.clinic c ON c.id = e.clinic_id
          WHERE e.id = $3
         ON CONFLICT DO NOTHING`,
        [tenantId, uuid7(700 + i), v.encounterId, op[0], op[1],
         `${100000000 + i * 137}`, primeiroUsuario]);
    }

    // O rascunho tambem leva convenio: e o caso que a tela de atendimento
    // precisa para o painel de exames funcionar — medico no meio da consulta
    // de um paciente de convenio, pedindo hemograma. Sem isto o painel abre
    // dizendo "particular" e a cadeia SP/SADT nao pode ser demonstrada.
    for (const [i, encounterId] of rascunhos.entries()) {
      const op = OPERADORAS[i % OPERADORAS.length]!;
      await c.query(
        `INSERT INTO clin.encounter_billing
           (tenant_id, id, encounter_id, operadora_nome, registro_ans,
            numero_carteira, atendimento_rn, cnes, cnpj_contratado,
            conselho_profissional, numero_conselho, uf_conselho, cbos,
            indicacao_acidente, regime_atendimento, tipo_consulta,
            data_atendimento, codigo_tabela, codigo_procedimento, valor_centavos,
            created_by)
         SELECT $1, $2, $3, $4, $5,
                $6, false, c.cnes, '11ABC22334DE55',
                '06', '123456', 'SP', '225125',
                '9', '01', '1',
                e.occurred_date, '22', '10101012', 15000, $7
           FROM clin.encounter e
           JOIN app.clinic c ON c.id = e.clinic_id
          WHERE e.id = $3
         ON CONFLICT DO NOTHING`,
        [tenantId, uuid7(900 + i), encounterId, op[0], op[1],
         `${200000000 + i * 137}`, primeiroUsuario]);
    }

    // Guias: projecao do atendimento. Semeadas direto porque a projecao real
    // acontece na finalizacao do prontuario, que o demo nao exercita.
    const guiaIds: string[] = [];
    for (let i = 0; i < Math.min(14, versoes.length); i += 1) {
      const id = uuid7(i);
      const quando = new Date();
      quando.setUTCDate(quando.getUTCDate() - (i + 2));
      await c.query(
        `INSERT INTO tiss.encounter_guia_consulta
           (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
            registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
            codigo_prestador_na_operadora,
            cnes, conselho_profissional, numero_conselho, uf_conselho, cbos,
            indicacao_acidente, regime_atendimento, data_atendimento,
            tipo_consulta, codigo_tabela, codigo_procedimento, valor_procedimento,
            live, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,'PREST001',
                 '2077501','06',$9,'SP','225125',
                 '9','01',$10::date,'1','22','10101012',$11,true,'completa',$12)`,
        [tenantId, id, versoes[i]!.encounterId, versoes[i]!.versionId,
         operadoraIds[i % operadoraIds.length],
         OPERADORAS[i % OPERADORAS.length]?.[1], `${20260000 + i}`,
         `${100000000 + i * 137}`, `${100000 + (i % 2)}`,
         dia(quando), [18000, 25000, 32000][i % 3], primeiroUsuario]);
      guiaIds.push(id);
    }

    // Um lote enviado, com as 6 primeiras guias.
    const loteId = uuid7();
    await c.query(
      `INSERT INTO tiss.lote
         (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
          guia_count, total_value_cents, sent_at, created_by)
       VALUES ($1,$2,$3,'2026080001','enviado','4.01',6,150000,
               clock_timestamp() - interval '6 days',$4)`,
      [tenantId, loteId, operadoraIds[0], primeiroUsuario]);
    for (const [i, gid] of guiaIds.slice(0, 6).entries()) {
      await c.query(
        `INSERT INTO tiss.lote_guia (tenant_id, lote_id, guia_id, sequencial_item)
         VALUES ($1,$2,$3,$4)`, [tenantId, loteId, gid, i + 1]);
    }

    // Demonstrativo de analise: a operadora respondeu, e glosou duas guias.
    const demoId = uuid7();
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, lote_id, protocolo_operadora, kind,
          data_processamento, xml_storage_key,
          total_apresentado_cents, total_processado_cents,
          total_liberado_cents, total_glosa_cents, imported_by)
       VALUES ($1,$2,$3,$4,'PROT-2026-0812','analise',
               (clock_timestamp() - interval '2 days')::date, $6,
               150000,150000,107000,43000,$5)`,
      // A chave e o UUID do proprio arquivo no object storage, sem extensao
      // (§10 item 14): o nome nunca revela conteudo.
      [tenantId, demoId, operadoraIds[0], loteId, primeiroUsuario, uuid7()]);

    const GLOSAS: readonly [number, string, string][] = [
      [25000, '1707', 'Procedimento nao coberto pelo plano'],
      [18000, '1401', 'Guia sem autorizacao previa'],
    ];
    for (const [i, [valor, codigo, descricao]] of GLOSAS.entries()) {
      const itemId = uuid7(i);
      await c.query(
        `INSERT INTO tiss.demonstrativo_item
           (tenant_id, id, demonstrativo_id, guia_id, numero_guia_prestador,
            valor_apresentado_cents, valor_processado_cents, valor_liberado_cents,
            valor_glosa_cents, glosa_codigo, glosa_descricao)
         VALUES ($1,$2,$3,$4,$5,$6,$6,0,$6,$7,$8)`,
        [tenantId, itemId, demoId, guiaIds[i], `${20260000 + i}`,
         valor, codigo, descricao]);
      await c.query(
        `INSERT INTO tiss.glosa
           (tenant_id, id, demonstrativo_item_id, guia_id, encounter_version_id,
            codigo_glosa, descricao_glosa, valor_glosado_cents, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pendente')`,
        [tenantId, uuid7(10 + i), itemId, guiaIds[i], versoes[i]!.versionId,
         codigo, descricao, valor]);
    }

    // ── Movimentacoes de estoque ────────────────────────────────────────────
    // Sem elas a aba de historico do estoque abre vazia, e um estoque sem
    // movimento nao explica como chegou no saldo que mostra.
    const { rows: prods } = await c.query(
      `SELECT id, name FROM inv.product WHERE tenant_id = $1 ORDER BY name`,
      [tenantId]);
    let movimentos = 0;
    for (const [i, prod] of prods.entries()) {
      // Uma entrada de compra e duas saidas de consumo por produto: e o ritmo
      // real de um consultorio, e faz o saldo atual parecer consequencia.
      const eventos: readonly [string, number, number][] = [
        ['entrada', 50 + (i % 3) * 25, 20 + i],
        ['saida', 8 + (i % 4), 9 + i],
        ['saida', 5 + (i % 3), 2 + i],
      ];
      for (const [tipo, qtd, diasAtras] of eventos) {
        await c.query(
          `INSERT INTO inv.stock_movement
             (tenant_id, id, product_id, kind, quantity, reason,
              reference_type, moved_by, moved_at)
           VALUES ($1,$2,$3,$4::inv.movement_kind,$5,$6,$7::inv.reference_type,$8,
                   clock_timestamp() - make_interval(days => $9::int))`,
          [tenantId, uuid7(movimentos), prod.id, tipo, qtd,
           tipo === 'entrada' ? 'Compra de reposicao' : 'Consumo em atendimento',
           tipo === 'entrada' ? 'compra' : 'uso_atendimento',
           primeiroUsuario, diasAtras]);
        movimentos += 1;
      }
    }

    // ── Conversas (WhatsApp) ────────────────────────────────────────────────
    // O diferencial nº 2 do produto. A caixa so demonstra alguma coisa com
    // conversa de verdade: confirmacao respondida, pergunta sem resposta, e um
    // numero que ainda nao virou paciente — os tres estados que a recepcao
    // encontra de manha.
    const identidadeId = uuid7();
    await c.query(
      `INSERT INTO msg.channel_identity
         (tenant_id, id, channel, display_name, phone, waba_ref, status)
       VALUES ($1,$2,'whatsapp','Aurora — Unidade Centro','+551133334444',
               'WABA-AURORA','active')`,
      [tenantId, identidadeId]);

    const CONVERSAS: readonly [number | null, string, readonly [string, string, number, boolean][]][] = [
      [0, '+5511987650001', [
        ['outbound', 'Bom dia! Confirmando sua consulta de amanha as 9h. Podemos contar com voce?', 180, true],
        ['inbound',  'Bom dia! Confirmo sim, obrigada', 172, true],
        ['outbound', 'Perfeito, ate amanha!', 170, true],
      ]],
      [1, '+5511987650002', [
        ['outbound', 'Ola! Seu resultado de exame ja esta disponivel na recepcao.', 90, true],
        ['inbound',  'Consigo retirar no sabado?', 42, false],
      ]],
      [null, '+5511987650003', [
        ['inbound',  'Boa tarde, voces atendem Unimed?', 25, false],
        ['inbound',  'E qual o valor da consulta particular?', 24, false],
      ]],
      [2, '+5511987650004', [
        ['outbound', 'Oi! Notamos que faltou a consulta de ontem. Quer remarcar?', 300, true],
        ['inbound',  'Quero sim, pode ser semana que vem?', 288, false],
      ]],
      [3, '+5511987650005', [
        ['outbound', 'Como foi seu atendimento? De 0 a 10, o quanto nos recomendaria?', 1440, true],
        ['inbound',  '10! Atendimento excelente', 1400, true],
      ]],
    ];

    let totalMensagens = 0;
    for (const [i, [indicePaciente, telefone, mensagens]] of CONVERSAS.entries()) {
      const conversaId = uuid7(i);
      const ultimaMin = mensagens[mensagens.length - 1]?.[2] ?? 0;
      await c.query(
        `INSERT INTO msg.conversation
           (tenant_id, id, channel_identity_id, patient_id, remote_phone, status,
            last_message_at)
         VALUES ($1,$2,$3,$4,$5,'active',
                 clock_timestamp() - make_interval(mins => $6::int))`,
        [tenantId, conversaId, identidadeId,
         indicePaciente === null ? null : pacientes[indicePaciente],
         telefone, ultimaMin]);

      for (const [direcao, texto, minutos, lida] of mensagens) {
        await c.query(
          `INSERT INTO msg.message
             (tenant_id, id, conversation_id, direction, channel, body_text,
              status, read_at, created_at)
           VALUES ($1,$2,$3,$4,'whatsapp',$5,
                   CASE WHEN $4 = 'outbound' THEN 'delivered' ELSE 'delivered' END,
                   CASE WHEN $6 THEN clock_timestamp() END,
                   clock_timestamp() - make_interval(mins => $7::int))`,
          [tenantId, uuid7(totalMensagens), conversaId, direcao, texto, lida, minutos]);
        totalMensagens += 1;
      }
    }

    // ── Lista de espera ─────────────────────────────────────────────────────
    for (const [i, prioridade] of ['urgente', 'alta', 'normal', 'normal'].entries()) {
      await c.query(
        `INSERT INTO sched.waitlist
           (tenant_id, id, patient_id, clinic_id, prioridade, observacao, created_by)
         VALUES ($1,$2,$3,$4,$5::sched.waitlist_priority,$6,$7)`,
        [tenantId, uuid7(i), pacientes[30 + i], clinicId, prioridade,
         ['Encaixe se abrir vaga', 'Prefere manha', 'Qualquer horario', 'So a tarde'][i],
         primeiroUsuario]);
    }

    // ── Respostas de NPS ────────────────────────────────────────────────────
    // A mistura importa: promotor, neutro e detrator convivendo e o que faz o
    // indice significar alguma coisa. Nove respostas todas 10 mostrariam uma
    // tela bonita que nao ensina a ler o numero. E a de 200 dias existe para
    // que o seletor de periodo tenha o que filtrar.
    const respostasNps: readonly [number, string | null, number][] = [
      [10, 'Atendimento impecavel, a Dra. explicou tudo com calma.', 3],
      [9,  'Consegui remarcar pelo WhatsApp em dois minutos.', 5],
      [9,  null, 8],
      [10, null, 11],
      [8,  'Bom atendimento, mas esperei 40 minutos alem do horario.', 14],
      [7,  null, 17],
      [5,  'Liguei tres vezes e ninguem atendeu para remarcar.', 21],
      [3,  'Cobraram um valor diferente do combinado na recepcao.', 26],
      [2,  'Resposta antiga, fora da janela de 30 dias.', 200],
    ];
    for (const [i, [score, comentario, dias]] of respostasNps.entries()) {
      await c.query(
        `INSERT INTO msg.nps_response
           (tenant_id, id, patient_id, score, comment, received_at)
         VALUES ($1,$2,$3,$4,$5, clock_timestamp() - make_interval(days => $6::int))`,
        [tenantId, uuid7(i), pacientes[i] ?? pacientes[0], score, comentario, dias]);
    }

    await c.query('COMMIT');

    process.stdout.write(
      `\nSemente pronta.\n\n` +
      `  Clinica ....... Aurora — Unidade Centro\n` +
      `  Pacientes ..... ${pacientes.length}\n` +
      `  Agendamentos .. ${agendamentos.length} (de ${dia(inicio0)})\n` +
      `  Recibos ....... ${numeroRecibo}\n` +
      `  NPS ........... ${respostasNps.length} respostas\n\n` +
      `  Entre com qualquer um destes, senha ${SENHA}:\n` +
      equipe.map((p) => `    ${p.email.padEnd(22)} ${p.papel}\n`).join('') +
      `\n`);
  } catch (e) {
    await c.query('ROLLBACK');
    process.stderr.write(`falhou: ${(e as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
}

void main();
