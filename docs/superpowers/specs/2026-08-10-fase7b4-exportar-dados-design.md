# Fase 7B-4 — Exportar dados da clinica

## Contexto

Admin clinico precisa exportar dados operacionais da clinica para backup, migracao de sistema ou compliance (LGPD). A funcionalidade fica na area de Configuracoes como uma nova aba "Exportar".

> Diferente do Explorar (Desempenho), que e um query builder sobre matviews analiticas, este export e direto nas tabelas operacionais — pacientes reais, agendamentos reais, lancamentos financeiros reais.

## Datasets

| Dataset | Tabela(s) | Colunas exportadas | Filtro por periodo |
|---|---|---|---|
| `pacientes` | `clin.patient` + `clin.patient_identifier` (CPF) | nome, nome_social, cpf, nascimento, sexo, telefone, email, status | nao |
| `equipe` | `app.equipe_da_unidade(clinic_id)` | nome, email, papel, conselho, desde | nao |
| `agendamentos` | `sched.appointment` + JOINs | data, horario, paciente, profissional, procedimento, status | sim |
| `financeiro` | `fin.entry` + JOINs | data, descricao, valor, tipo, metodo, categoria, status | sim |

Limite maximo: 50.000 linhas por exportacao (mesmo teto do Explorar).

## Authz

Nova acao: `data.export` — somente `admin_clinico`, `requiresMfa: true`.

Exportar dados operacionais e sensivel: contem PII de pacientes, dados financeiros. MFA obrigatorio.

## API

```
POST /v1/configuracoes/exportar
Guard: rota('data.export', ...)
Body: { dataset: 'pacientes' | 'equipe' | 'agendamentos' | 'financeiro',
        format: 'csv' | 'xlsx',
        dateFrom?: string,   // YYYY-MM-DD, obrigatorio para agendamentos/financeiro
        dateTo?: string }
Response: binary file com Content-Disposition: attachment
```

Validacoes:
- `dateFrom` e `dateTo` obrigatorios quando dataset e `agendamentos` ou `financeiro`
- Intervalo maximo: 365 dias
- `format` validado por zod enum

## Queries

### Pacientes

```sql
SELECT p.full_name, p.nome_social,
       (SELECT pi.value FROM clin.patient_identifier pi
        WHERE pi.patient_id = p.id AND pi.kind = 'CPF' LIMIT 1) AS cpf,
       p.birth_date, p.sex_at_birth, p.phone_primary, p.email,
       p.cadastro_status
FROM clin.patient p
WHERE p.inactivated_at IS NULL AND p.merged_into_id IS NULL
ORDER BY p.full_name
LIMIT 50000
```

RLS ja filtra por tenant. Dados clinicos (prontuario) NAO sao incluidos — export de prontuario ja existe em `packages/export/` com fluxo proprio.

### Equipe

Reutiliza `app.equipe_da_unidade(clinic_id)` (SECURITY DEFINER). Colunas: nome, email, role, conselho, created_at.

### Agendamentos

```sql
SELECT a.start_time, a.end_time, pat.full_name AS paciente,
       prof.display_name AS profissional, proc.name AS procedimento,
       a.status
FROM sched.appointment a
JOIN clin.patient pat ON pat.id = a.patient_id
JOIN app.membership m ON m.user_id = a.professional_id AND m.clinic_id = a.clinic_id
JOIN id.user prof ON prof.id = m.user_id
LEFT JOIN sched.procedure proc ON proc.id = a.procedure_id
WHERE a.start_time >= $dateFrom AND a.start_time < $dateTo + 1
ORDER BY a.start_time
LIMIT 50000
```

### Financeiro

```sql
SELECT e.due_date, e.description, e.amount_cents, e.kind,
       pm.name AS metodo, c.name AS categoria, e.status
FROM fin.entry e
LEFT JOIN fin.payment_method pm ON pm.id = e.payment_method_id
LEFT JOIN fin.category c ON c.id = e.category_id
WHERE e.due_date >= $dateFrom AND e.due_date <= $dateTo
ORDER BY e.due_date
LIMIT 50000
```

## Frontend

Nova pagina: `apps/web/app/configuracoes/exportar/page.tsx`

Componente `ExportarDados` em `apps/web/src/telas/ExportarDados.tsx`:
- Radio group para selecionar dataset
- Radio group para formato (CSV / XLSX)
- Campos de data (De / Ate) — visiveis quando dataset requer periodo
- Botao "Exportar" dispara download via fetch + blob

Nova aba no layout: `{ value: 'exportar', rotulo: 'Exportar', href: '/configuracoes/exportar' }` — posicionada antes de "Catalogos".

## Audit

Evento: `DATA_EXPORT` com meta `{ dataset, format, row_count }`.

## Fora de escopo

- Export de prontuario (ja existe em `packages/export/`)
- Export de trilha de auditoria (ja visivel na aba Auditoria)
- Export incremental / streaming
- Agendamento de exports periodicos
