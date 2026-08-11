# Fase 7B-5 — Contatos do Paciente

## Contexto

O cadastro de paciente (`clin.patient`) possui `phone_primary` e `email`, mas:
1. Nao existe rota para editar telefone/email apos criacao
2. O email e retornado pelo GET /v1/pacientes/:id mas nao e exibido na FichaDoPaciente
3. A secao "Contato" da ficha mostra apenas telefone

## Escopo

### Incluido

1. **PATCH /v1/pacientes/:id/contato** — atualizar `phone_primary` e `email`
   - Guard: `patient.write`
   - Validacao: telefone >= 10 digitos, email valido ou nulo
   - Atualiza `search_digits` quando telefone muda
   - Audit log: `PATIENT_CONTACT_UPDATE` com meta `{ field, old_value }`
   - Ao menos um canal (telefone ou email) deve permanecer preenchido (regra `canal_obrigatorio`)

2. **Exibir email na FichaDoPaciente** — adicionar `email` ao `FichaDoPacienteProps` e renderizar na secao Contato

3. **Edicao inline de contato** — na secao Contato da FichaDoPaciente, botao "Editar" que abre campos editaveis para telefone e email com salvar/cancelar

4. **Migration 0163** — adicionar `phone_secondary` e `emergency_contact_name`, `emergency_contact_phone` a `clin.patient`; adicionar chaves de auditoria

5. **Contato de emergencia** — exibir e editar na secao Contato

### Excluido

- Endereco (sera tratado em fase futura se necessario)
- Multiplos telefones alem de primario + secundario
- Integracao com messaging (phone_primary ja e usado; nao mudar contrato)

## Dados

### Novos campos em `clin.patient` (migration 0163)

| Coluna | Tipo | Default |
|---|---|---|
| `phone_secondary` | `varchar(20)` | NULL |
| `emergency_contact_name` | `varchar(200)` | NULL |
| `emergency_contact_phone` | `varchar(20)` | NULL |

### Chaves de auditoria novas

`field`, `old_value`, `new_value` — adicionadas ao `audit.meta_keys_ok`

## API

### PATCH /v1/pacientes/:id/contato

```
Body: {
  phonePrimary?: string | null
  phoneSecondary?: string | null
  email?: string | null
  emergencyContactName?: string | null
  emergencyContactPhone?: string | null
}
```

Regras:
- Ao menos `phonePrimary` ou `email` deve ficar preenchido apos update
- Telefones sao normalizados (so digitos), minimo 10 digitos
- Email validado com regex basico
- `search_digits` recalculado se telefone primario mudar

Resposta: `200 { patientId }`

### GET /v1/pacientes/:id (atualizar)

Adicionar ao response: `phoneSecondary`, `emergencyContactName`, `emergencyContactPhone`

## Frontend

### FichaDoPaciente — secao Contato expandida

```
Contato                              [Editar]
Telefone principal    (11) 98765-4321
Telefone secundario   --
Email                 email@exemplo.com
---
Contato de emergencia                [Editar]
Nome                  Maria da Silva
Telefone              (11) 91234-5678
```

Modo edicao: campos de input inline com botoes Salvar/Cancelar.

## Tarefas

1. Migration 0163 + chaves de auditoria
2. PATCH /v1/pacientes/:id/contato + testes de integracao
3. Atualizar GET /v1/pacientes/:id response
4. Componente SecaoContato editavel + testes unitarios
5. Integrar na FichaDoPaciente + page wiring
