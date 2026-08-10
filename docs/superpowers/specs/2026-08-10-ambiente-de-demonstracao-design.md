# Ambiente de demonstração — design

**Data:** 2026-08-10
**Status:** aprovado para execução
**Custo alvo:** US$ 12/mês + tributos

## 1. O que este ambiente é, e o que ele não é

**É:** um lugar onde o produto roda de ponta a ponta, com dados fictícios, para ser
mostrado e navegado. Frontend já publicado na Vercel, API e worker numa instância
Lightsail em São Paulo, PostgreSQL 18 no mesmo host.

**Não é:** produção. Não recebe paciente real, e a distinção não é de grau — é de
natureza. A [decisão 16](2026-08-03-design-sistema.md) exige região sa-east-1 **sem CDN
na frente de HTML/API**, e a Vercel é um CDN na frente do HTML. Enquanto o dado for
fictício isso é irrelevante; no instante em que deixar de ser, este ambiente está
errado e a arquitetura documentada (ECS Fargate · RDS Multi-AZ · S3 SSE-KMS ·
Secrets Manager, ~US$ 450–635/mês) passa a ser obrigatória.

Registrar isso aqui é o ponto principal do documento. O risco real não é técnico, é
de deriva: um ambiente de demonstração que funciona bem demais vira produção por
inércia, sem que ninguém tome a decisão de promovê-lo.

**Guarda contra a deriva:** o ambiente roda com `CADENCIA_PROVIDERS=fake`. Nenhuma
receita chega à Memed, nenhuma mensagem à Meta, nenhum pagamento ao PSP. Se alguém
tentar usá-lo para valer, os documentos saem explicitamente pendentes — o sistema
recusa em vez de fingir.

## 2. Isolamento do projeto RenoveJa

A conta AWS (`064212133215`) é compartilhada com o projeto RenoveJa, dono do usuário
IAM em uso. Restrição do cliente: não misturar.

| Mecanismo | Regra |
|---|---|
| Nomes | Todo recurso leva prefixo `cadencia-` |
| Tags | `Projeto=cadencia` em tudo que aceitar tag |
| Escopo | Nenhum recurso pré-existente é lido, alterado ou reaproveitado |
| Orçamento | Alerta filtrado por tag, para não somar gasto do RenoveJa |
| Domínio | Nenhum domínio de outro projeto é usado — daí a escolha da topologia A (§3) |

## 3. Topologia

```
navegador ──HTTPS──> Vercel (cadencia-nine.vercel.app)
                        │  rewrite /v1/* — server-side, na função
                        ▼
                  Lightsail sa-east-1 · cadencia-demo
                  ┌──────────────────────────────┐
                  │ docker compose               │
                  │  ├─ postgres:18  (volume)    │
                  │  ├─ api     Fastify :3001    │
                  │  └─ worker  jobs             │
                  └──────────────────────────────┘
```

O navegador só conhece o domínio da Vercel, sempre em HTTPS. Isso não é preferência:
o cookie de sessão usa o prefixo `__Host-` e a API o marca `secure: true` de forma
incondicional ([sessao.ts:100](../../../apps/api/src/routes/sessao.ts)). Cookie `Secure`
sobre HTTP puro é descartado pelo navegador — **acessar a API diretamente pelo IP não
permite login, por construção**. O rewrite do Next resolve: para o navegador, `/v1/*`
é a mesma origem do app.

**Trecho Vercel → Lightsail:** HTTP puro pela internet pública. É a dívida consciente
desta topologia. Aceitável com dado fictício; inaceitável com dado real. A migração
para TLS ponta a ponta é: apontar um subdomínio para o IP, subir Caddy com
Let's Encrypt, trocar `API_ORIGIN`. Não reescreve nada.

**Região das funções da Vercel:** hoje `iad1` (Washington). Tentativa de mover para
`gru1` (São Paulo) para eliminar a ida aos EUA a cada requisição. Se o plano Hobby não
permitir, fica registrado como limitação conhecida, não como falha.

## 4. Componentes

| Componente | Escolha | Por quê |
|---|---|---|
| Host | Lightsail `small_3_1`, sa-east-1 | US$12/mês fixo, IPv4 público incluso, região brasileira |
| Banco | Imagem oficial `postgres:18`, volume Docker | Gerenciado barato não entrega PG 18, nem `initdb --locale=C.UTF-8`, nem `ALTER ROLE jobs BYPASSRLS` |
| API | Container Node 24 rodando `tsx src/server.ts` | `apps/api` não tem passo de build; `main` aponta para `.ts` |
| Worker | Mesmo container, comando diferente | Mesmas dependências; separar imagem não paga o custo |
| Providers | `CADENCIA_PROVIDERS=fake` | Zera credenciais de terceiros e impede uso real acidental |
| Storage | `FsStorageAdapter` em volume | Anexos sobrevivem a restart do container |

**Por que 2 GB e não 1 GB:** `postgres:18` mais Node da API mais worker convivem em
2 GB com folga; a instalação de dependências do monorepo é o pico de memória e é onde
1 GB falharia. Swap configurado como rede de segurança para esse pico.

## 5. Segredos

Em modo `fake` sobram dois tipos:

| Segredo | Origem | Quem vê |
|---|---|---|
| Senhas de `api`, `jobs`, `support` | Geradas **na instância** com `openssl rand` | Ninguém fora dela |
| `CADENCIA_TOTP_KEY` | Gerada **na instância**, 32 bytes base64 | Ninguém fora dela |

Nenhum segredo trafega pela sessão de desenvolvimento, aparece em log ou entra no
repositório. O `.env` nasce e morre na instância. Não há credencial de terceiro
porque `fake` não usa nenhuma.

## 6. Fluxo de implantação

1. Criar instância `cadencia-demo` (blueprint `ubuntu_24_04`, bundle `small_3_1`, sa-east-1), tag `Projeto=cadencia`
2. Abrir porta 3001/tcp no firewall; 22 já vem aberta
3. Instalar Docker e Compose
4. Clonar o repositório em `main`
5. Gerar `.env` na instância (senhas e chave TOTP)
6. `docker compose up -d db` e aguardar `healthy`
7. Aplicar as 156 migrations (`pnpm db:migrate`, em container efêmero) e as senhas dos papéis de login
8. `docker compose up -d api worker`
9. Semear a demonstração (`scripts/semear-demo.ts`)
10. Configurar `API_ORIGIN` na Vercel e redeployar — a variável é lida **no build**
11. Criar o alerta de orçamento filtrado por tag

## 7. Verificação — o que prova que funcionou

Nenhuma etapa é dada como concluída sem a evidência ao lado.

| Afirmação | Prova |
|---|---|
| Banco de pé | `pg_isready` retorna 0 |
| Migrations aplicadas | Contagem em `public.schema_migration` igual a 156 (a sequência vai até 0157 sem o 0097) |
| API respondendo | `GET /v1/...` na instância retorna status HTTP, não recusa de conexão |
| Proxy da Vercel funcionando | `/v1/*` no domínio público deixa de retornar `DNS_HOSTNAME_RESOLVED_PRIVATE` |
| Login funcionando | `POST /v1/sessao` devolve `Set-Cookie: __Host-cadencia_sid` |
| Demo navegável | Rotas principais em 200 e com dado semeado visível |
| Custo sob controle | Orçamento criado e instância única listada |

## 8. Erros previstos e resposta

| Falha | Sintoma | Resposta |
|---|---|---|
| Memória no `pnpm install` | OOM kill | Swap de 2 GB antes de instalar |
| Migration falha no meio | Erro na 0001 por privilégio | Migrations rodam como `postgres` do container, que é superusuário real |
| Vercel não alcança a instância | Timeout no rewrite | Conferir firewall 3001 e IPv4 público |
| Cookie não grava | Login falha sem erro visível | Confirmar que o navegador só fala com a Vercel em HTTPS |
| Hobby não permite `gru1` | Erro ao definir região | Registrar limitação; a latência extra não impede a demo |

## 9. O que a execução revelou

Três defeitos apareceram na publicação. Nenhum era de infraestrutura — todos
estavam no repositório, invisíveis para a suíte.

**1. Versão do gerenciador de pacotes não fixada.** O `corepack enable` do
Dockerfile trouxe pnpm 11.21.0, uma major à frente do 10 que a máquina local e o
CI usam; o pnpm 11 promoveu `ERR_PNPM_IGNORED_BUILDS` a erro fatal. Contornado
cravando a versão no Dockerfile. A correção de raiz — declarar `packageManager`
no `package.json` — fica para tarefa própria, porque exige ajustar o
`pnpm/action-setup` do CI junto.

**2. O worker nunca havia iniciado.** Dois defeitos independentes, ambos no boot:
o `pg-boss` 10 exige `createQueue` antes de `work`/`schedule` e o worker não
chama nenhuma; e `Contractor.start()` emite `CREATE SCHEMA IF NOT EXISTS` no
primeiro boot, privilégio que `jobs` não tem. Verificado empiricamente que o
PostgreSQL checa o privilégio **antes** de avaliar o `IF NOT EXISTS` — pré-criar
o schema não resolve. Desbloqueado nesta instância com concessão transitória
seguida de revogação (o padrão da 0002/0134) e criação das filas por script
avulso. **Nada disso está versionado**: recriar o banco quebra o worker de novo.

**3. Nenhum teste inicia `startWorker()`.** É a causa de fundo do item 2. Há
teste para cada job, mas nada exercita o processo — por isso os defeitos
atravessaram 1.149 testes de integração e 231 de isolamento sem sinal nenhum.

## 10. Custo

| Item | US$/mês |
|---|---|
| Lightsail `small_3_1` | 12,00 |
| Transferência (franquia 1.536 GB; uso estimado < 10 GB) | 0,00 |
| IP estático anexado, snapshots desligados | 0,00 |
| Vercel Hobby | 0,00 |
| **Total antes de tributos** | **12,00** |

Franquia de transferência comporta ~500 mil sessões/mês, considerando 2–3 MB por
sessão a partir dos tamanhos reais do build. Tributos brasileiros ou IOF entram por
cima. **Não há trava automática de gasto na AWS** — o alerta de orçamento notifica,
não interrompe.

**Ressalva:** o plano Hobby da Vercel é para uso não comercial. Demonstrar o produto a
clientes em potencial é uso comercial pelos termos deles, o que exigiria o plano Pro
(US$ 20/mês) e levaria o total a ~US$ 32–35.
