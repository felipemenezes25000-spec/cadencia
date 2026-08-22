# Cadência — prontidão para PEC público e contratações

## Objetivo

O Cadência é o produto de Prontuário Eletrônico do Cidadão (PEC). Ele deve ser implantável de forma independente em município/unidade de saúde e não depende da plataforma RRAS2 para funcionar.

A referência imediata é a ação do Plano de Ação de Transformação para a Saúde Digital da RRAS 2: **Implantação do Prontuário Eletrônico do Paciente nos Estabelecimentos de Saúde dos Municípios**, com meta de implantar PEC nos estabelecimentos, indicador percentual de estabelecimentos implantados e previsão de R$ 3.762.000,00 de custeio. A memória de cálculo separa R$ 1.650.000,00 para migração de dados e R$ 2.112.000,00 para hospedagem em nuvem. O plano também vincula a ação à adoção de prontuários eletrônicos que atendam aos padrões de interoperabilidade da RNDS.

Fonte: https://www.cosemssp.org.br/wp-content/uploads/2025/05/PA-RRAS-2-PosEnvio-MS.pdf

## Princípio de produto

- Cadência é o sistema de registro clínico e a fonte de verdade do prontuário.
- Deve operar sozinho, com frontend, API, banco, auditoria, assinatura, agenda, documentos, prescrições, anexos e integrações.
- Sistemas regionais, centrais de regulação ou plataformas de telessaúde integram com o Cadência por API/eventos; não duplicam o conteúdo clínico.
- Nenhum ambiente pode declarar transmissão para RNDS/e-SUS APS como bem-sucedida sem resposta real do destino.

## Núcleo já existente

O repositório já possui prontuário versionado, autosave, finalização imutável, retificação/adendo, documentos, prescrição, anexos, assinatura, auditoria, RLS, agenda, teleconsulta, estoque, LGPD, município/IBGE, CNES, INE, CNS/CBO, territorialização APS, regulação, CID, CIAP-2, SIGTAP e contratos de interoperabilidade.

## Camada operacional de implantação

A migration `0201_public_pec_operations.sql` adiciona:

- perfil operacional por unidade com SLA, RPO, RTO, retenção e residência de dados;
- controle de migrações com origem, snapshot SHA-256, contagens e reconciliação;
- ledger de interoperabilidade com idempotência, hash do payload, protocolo, tentativas e erros;
- evidências de restore, DR, segurança, reconciliação, treinamento, homologação e go-live;
- RLS forçada e isolamento por tenant/unidade em todos os novos registros.

A API `/v1/implantacao/*` expõe checklist de prontidão, migrações, evidências, interoperabilidade e parâmetros operacionais. A tela `/implantacao` consolida esses dados para gestão e aceite.

## Critérios mínimos de go-live

O painel trata como bloqueadores técnicos:

1. município IBGE/UF configurado;
2. CNES da unidade configurado;
3. profissionais ativos com CNS e CBO;
4. nenhuma migração em estado de falha como última execução;
5. RNDS declarada como homologada ou produção.

São alertas, porque dependem do escopo local: cobertura de INE, CNS dos cidadãos, carga de CIAP-2/SIGTAP, evidência de restore e integração e-SUS APS/SIAPS.

Os estados `CADENCIA_RNDS_STATUS` e `CADENCIA_ESUS_APS_STATUS` aceitam apenas `not_configured`, `sandbox`, `homologated` e `production`. Eles são uma declaração operacional para o painel; **não constituem prova de homologação**. A prova deve ser registrada como evidência, com protocolo/artefato verificável.

## RNDS

A RNDS usa HL7 FHIR R4 e perfis/artefatos definidos pelo Ministério da Saúde. O Cadência deve validar payloads contra os artefatos oficiais e manter protocolo, idempotência, tentativas, rejeições e trilha de auditoria.

Referências oficiais:

- https://rnds-guia.saude.gov.br/
- https://rnds-fhir.saude.gov.br/

A integração real depende de credenciamento, certificados/segredos e homologação do estabelecimento/integrador. O código não deve embutir credenciais nem simular aceite.

## e-SUS APS / SIAPS

Sistemas próprios que integram produção de APS devem acompanhar o layout e os modelos de informação vigentes. Mudanças de versão incompatíveis podem invalidar dados enviados ao SIAPS; por isso a integração deve ser versionada por competência e acompanhada de testes de conformidade.

A implementação final deve usar a documentação oficial vigente do e-SUS APS/LEDI no momento da implantação. Adapters não configurados devem falhar de forma explícita e observável.

## Migração de dados

Cada município/fonte legada exige mapeamento específico. O pipeline obrigatório é:

`extração -> snapshot/hash -> staging -> validação -> normalização -> identificação/deduplicação -> importação -> reconciliação -> relatório -> aceite`

O relatório de cada execução deve registrar, no mínimo, recebidos, válidos, importados, conciliados e rejeitados. Rejeições precisam ser reproduzíveis e não podem ser descartadas silenciosamente.

A camada operacional agora registra o processo, mas os conectores de origem (banco/API/CSV/XML/JSON/FHIR) devem ser implementados conforme os sistemas efetivamente encontrados nos municípios. Não é correto criar conversores fictícios antes de conhecer os layouts de origem.

## Nuvem, continuidade e aceite

A infraestrutura de produção já possui base para criptografia, S3/KMS, RDS Multi-AZ, backups, observabilidade, WAF e execução em ECS/Fargate. Para cada implantação contratual devem ser definidos e comprovados:

- SLA mensal;
- RPO e RTO;
- política de retenção;
- rotina de backup e PITR;
- teste periódico de restauração;
- plano de desastre;
- monitoramento e alertas;
- residência de dados;
- evidências de treinamento e go-live;
- relatórios de disponibilidade e incidentes.

## O que nunca deve ser marcado como concluído apenas por código

- credenciamento/homologação RNDS;
- homologação/aceite e-SUS APS/SIAPS quando aplicável;
- aceite da migração pelo município;
- teste de restore sem execução real;
- treinamento sem lista/evidência real;
- go-live sem aceite do ambiente;
- certificações externas (SBIS/CFM, quando exigidas pelo objeto).

## Regra de evolução

Todo novo edital/termo de referência deve gerar uma matriz de aderência com quatro estados: `atende`, `atende_parcial`, `não_atende`, `dependência_externa`. Requisitos externos nunca devem ser convertidos em falso `atende` por mock, feature flag ou texto de documentação.
