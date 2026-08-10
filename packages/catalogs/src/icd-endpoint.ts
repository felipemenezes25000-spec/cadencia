/**
 * A API da CID-11 tem dois modos, e eles autenticam diferente.
 *
 * O servico publico da OMS (`id.who.int`) exige OAuth2 client credentials. A
 * MESMA API rodando em container proprio (`whoicd/icd-api`) nao exige nada — a
 * documentacao da OMS e explicita: "the locally deployed versions do not
 * require OAUTH-2 authentication".
 *
 * Sem esta distincao, quem sobe a instancia propria — que e o modo CORRETO em
 * producao, para nao depender do servidor da OMS estar de pe no meio de uma
 * carga de dezenas de milhares de requisicoes — seria obrigado a se registrar em
 * id.who.int so para falar com a propria maquina.
 */

/** Hosts que sao, por definicao, a maquina local ou a rede do compose. */
function ehLocal(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return true;
  }
  // Nome de servico do compose nao tem ponto: `icd-api`, `cadencia-icd-api`.
  // Qualquer coisa com dominio (`icd.exemplo.com.br`) e externa.
  return !hostname.includes('.');
}

export function exigeOauth(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    // URL invalida cai no lado seguro: pedir credencial. Mandar requisicao sem
    // token para um host qualquer devolveria 401, e o erro apareceria como "a
    // OMS recusou" — escondendo que o que faltava era configuracao.
    return true;
  }
  return !ehLocal(host);
}
