### Task 20: Rodar a suite completa — todos os invariantes e testes de isolamento verdes

**Arquivos**

- Nenhum arquivo novo. Esta tarefa e a prova de que as tres migrations e os testes convivem com o schema existente.

**Passos**

- [ ] Rodar os invariantes de CI:

```bash
pnpm db:invariants
# Esperado: todos passam. Em particular:
# - inv01 (RLS): tiss.encounter_guia_consulta, tiss.guia_ajuste e tiss.guia_counter
#   tem RLS habilitada e forcada com ao menos uma policy.
# - inv02 (FK composta): todas as FKs das tres tabelas sao compostas com tenant_id.
# - inv07 (privilegios): as entradas em privileges.json batem com os GRANTs reais.
# - inv08 (DDL lint): nenhuma ocorrencia de now()/current_date no schema tiss.
#   Nenhum indice de tabela multi-tenant sem tenant_id na primeira coluna.
```

- [ ] Rodar o lint de terminologia de relogio:

```bash
pnpm lint:terminology-clock
# Esperado: exit 0 — nenhuma ocorrencia de now()/current_date nas migrations
# do schema tiss.
```

- [ ] Rodar os privilegios:

```bash
pnpm db:privileges
# Esperado: exit 0 — privileges.json e o banco estao alinhados.
```

- [ ] Rodar a suite completa de isolamento:

```bash
pnpm test:iso
# Esperado: todos os testes passam, incluindo os novos 31, 32 e 33.
# A impressao digital do tenant B inclui as tres tabelas novas.
# O teste meta (04-t1-t2-isolamento) confirma que o seed criou linha do
# tenant B em todas as tabelas multi-tenant, incluindo as do schema tiss.
```

- [ ] Rodar a verificacao de arquitetura:

```bash
pnpm arch:check
# Esperado: 0 violacoes — as migrations nao importam modulos de aplicacao.
```

- [ ] Rodar o typecheck:

```bash
pnpm typecheck
# Esperado: exit 0.
```