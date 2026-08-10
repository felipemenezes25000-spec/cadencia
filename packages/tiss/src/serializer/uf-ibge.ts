// packages/tiss/src/serializer/uf-ibge.ts

/**
 * Sigla da UF para o codigo do IBGE que o TISS exige.
 *
 * O dominio `dm_UF` do XSD 4.03.00 NAO aceita 'SP' — aceita '35'. O cadastro de
 * profissional guarda a sigla, porque e o que o CRM emite e o que a recepcao
 * digita; a norma quer o codigo numerico. Sem esta traducao, toda guia sai com
 * `<ans:UF>SP</ans:UF>` e a operadora recusa o lote inteiro.
 *
 * Os codigos sao os da Tabela de Unidades da Federacao do IBGE: primeiro digito
 * e a regiao (1 Norte, 2 Nordeste, 3 Sudeste, 4 Sul, 5 Centro-Oeste). Por isso
 * nao sao sequenciais nem alfabeticos.
 */
const CODIGO: Readonly<Record<string, string>> = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17',
  MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27',
  SE: '28', BA: '29',
  MG: '31', ES: '32', RJ: '33', SP: '35',
  PR: '41', SC: '42', RS: '43',
  MS: '50', MT: '51', GO: '52', DF: '53',
  // '98' e o codigo de exterior previsto no proprio dominio — profissional com
  // registro fora do pais existe e precisa faturar.
  EX: '98',
};

export function ufParaCodigoIbge(sigla: string): string {
  const chave = sigla.trim().toUpperCase();
  const codigo = CODIGO[chave];
  if (codigo === undefined) {
    // Falhar alto e proposital. Devolver '98' calado poria a guia no ar com a
    // UF errada, e a glosa voltaria semanas depois sem rastro da causa.
    throw Object.assign(new Error('uf_desconhecida'), { dominio: 'uf_desconhecida', sigla });
  }
  return codigo;
}
