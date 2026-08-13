# Cadencia — endurecimento de produção e experiência

## Objetivo

Transformar o estado atual do Cadencia em uma entrega coerente e verificável: sem rotas que aparentam persistir mas descartam dados, sem endpoints administrativos fora do guard de sessão, com as telas existentes alcançáveis e funcionais, e com uma identidade visual própria para o trabalho clínico em desktop e mobile.

O produto continua sendo um sistema operacional para clínicas brasileiras de 1 a 30 profissionais. A prioridade da interface é sempre **paciente → estado atual → contexto → próxima ação**.

## Estratégia

Será feito endurecimento incremental no monorepo existente. Uma reescrita descartaria invariantes valiosos de RLS, auditoria, prontuário imutável e TISS; portanto, as fronteiras atuais (Next.js → Fastify → PostgreSQL, com worker para efeitos assíncronos) permanecem.

Três frentes avançam em ordem:

1. estabilizar os gates locais e separar falhas reais de interferência entre processos;
2. substituir stubs expostos ao usuário por persistência real, autorização e contratos testados;
3. restaurar e lapidar a identidade operacional, completar superfícies sem ação e verificar visualmente rotas críticas.

## Segurança e backend

- Toda rota privada usa `rota(...)`/`comTransacao(...)`; sessão, unidade, CSRF, papel e MFA não podem ser contornados.
- Notificações e configuração de canais ganham tabelas tenant-scoped, RLS forçada, FKs compostas quando aplicáveis e migrations forward-only.
- Operações de leitura respeitam paginação e ordenação determinística. Escritas retornam o estado realmente persistido.
- Endpoints administrativos duplicados devem delegar ao modelo real existente ou ser implementados com o mesmo contrato. Nenhum endpoint retorna sucesso fictício.
- Logs de erro continuam opacos para o cliente e correlacionáveis pelo `requestId` no servidor.

## Telas e fluxos faltantes

- `/notificacoes`: lista persistida, filtro por não lidas, leitura individual e em lote.
- `/configuracoes/canais`: lista e criação persistidas; identidades reais do canal são exibidas.
- `/configuracoes/permissoes`: clínicas reais e overrides persistidos por unidade.
- Hub `/catalogos`: Bulário aponta para `/bulas`, sem “em breve”.
- Atendimento: pedido de exame abre `PainelDeSadt`; documentos só são apresentados como ação quando existe handler funcional.
- Paciente: Documentos carrega os artefatos existentes, com loading, erro e vazio reais, em vez de um vazio estático.

## Direção visual

### Paleta

- `Midnight #081F27`: shell e orientação.
- `Clinical teal #087783`: ação, foco e estado ativo.
- `Cold canvas #F3F6F7`: área de trabalho.
- `Paper #FFFFFF`: conteúdo clínico.
- `Ink #17313B`: texto principal.
- `Signal amber #96601C` e `Signal red #A04249`: atenção e risco.

### Tipografia

Inter/system UI permanece para alta legibilidade e previsibilidade hospitalar. Hierarquia vem de peso, largura e espaçamento; não haverá nova fonte remota nem dependência de rede para renderizar a aplicação.

### Layout e assinatura

O shell midnight funciona como “trilho de contexto”; a superfície branca é o papel clínico. A assinatura memorável é o **ritmo operacional vivo**: estados Agora/Próximo/Pendências e marcadores de cadência guiam a atenção, sem gradientes atrás de texto clínico ou tabelas.

No cockpit, o fluxo do dia aparece antes do painel auxiliar em qualquer largura de coluna única. O rail só fica ao lado quando há espaço útil real. Em mobile, ações primárias permanecem visíveis e o dock não cobre conteúdo.

O login azul-claro já tem identidade própria e usa cores locais; ele não exige um override cromático global sobre o produto autenticado.

## Acessibilidade e responsividade

- WCAG AA como piso: foco visível, labels reais, nomes acessíveis, sem significado somente por cor.
- Alvos móveis de pelo menos 44 px para ações críticas.
- Breakpoints verificados em 390×844 e desktop; tabelas têm estratégia explícita de cards ou overflow.
- `prefers-reduced-motion` é respeitado e nenhuma informação depende de hover.

## Qualidade e produção

- Mudanças comportamentais seguem teste falhando → implementação mínima → regressão verde.
- Gates finais: tipos, unidade, web/jsdom, build Next, arquitetura, lints próprios, authz, integração PostgreSQL, invariantes e isolamento quando o Docker local permitir.
- O teste de Compose executa a renderização uma vez por arquivo e possui limite compatível com inicialização fria do Docker no Windows.
- JSDOM recebe um canvas mínimo para que gráficos não produzam centenas de erros de ambiente.
- O build de produção é executado isoladamente; `.next` não é compartilhado com outro build concorrente.

## Fora de escopo

- Contratar ou ativar provedores reais de WhatsApp, SMS, e-mail, assinatura ou pagamento.
- Declarar conformidade regulatória ou liberar dados reais sem a implantação das salvaguardas de produção já documentadas.
- Refazer módulos estáveis apenas por preferência estética.
