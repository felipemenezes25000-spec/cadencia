/**
 * A API da CID-11 tem dois modos, e eles autenticam diferente.
 *
 * O serviço público da OMS (`id.who.int`) exige OAuth2 client credentials. A
 * MESMA API rodando em container próprio (`whoicd/icd-api`) não exige nada — a
 * documentação da OMS é explícita: "the locally deployed versions do not
 * require OAUTH-2 authentication".
 *
 * Sem esta distinção, quem sobe a instância própria — que é o modo CORRETO em
 * produção, para não depender do servidor da OMS estar de pé no meio de uma
 * carga de dezenas de milhares de requisições — seria obrigado a se registrar em
 * id.who.int só para falar com a própria máquina.
 */

/** Hosts que são, por definição, a máquina local ou a rede do compose. */
function ehLocal(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return true;
  }
  // Nome de serviço do compose não tem ponto: `icd-api`, `cadencia-icd-api`.
  // Qualquer coisa com domínio (`icd.exemplo.com.br`) é externa.
  return !hostname.includes('.');
}

export function exigeOauth(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    // URL inválida cai no lado seguro: pedir credencial. Mandar requisição sem
    // token para um host qualquer devolveria 401, e o erro apareceria como "a
    // OMS recusou" — escondendo que o que faltava era configuração.
    return true;
  }
  return !ehLocal(host);
}
