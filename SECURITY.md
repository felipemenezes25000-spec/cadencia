# Política de divulgação de vulnerabilidades

O Cadência processa dados de saúde e trata segurança como requisito de produto.

## Como reportar

Não abra issue pública com credenciais, dados pessoais, detalhes de exploração ou evidência de acesso indevido. Use o canal privado de segurança do repositório (GitHub Private Vulnerability Reporting, quando habilitado) ou contato privado do mantenedor.

Inclua, quando possível: componente afetado, versão/SHA, pré-condições, impacto, passos mínimos de reprodução e sugestão de mitigação. Não inclua dados reais de pacientes.

## Escopo prioritário

Falhas de autenticação/autorização, quebra de isolamento multi-tenant, acesso indevido a prontuário/anexos, execução remota, SSRF, injeção, exposição de segredo, bypass de auditoria, corrupção de integridade clínica e falhas criptográficas são tratadas como prioridade máxima.

## Processo

Uma vulnerabilidade confirmada deve receber correção em branch privada quando a divulgação antecipada aumentar risco, teste de regressão, revisão do impacto histórico, rotação de segredo quando aplicável e registro do incidente. A publicação de detalhes deve ocorrer somente depois de mitigação suficiente.
