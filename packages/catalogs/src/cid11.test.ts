import { describe, expect, it } from 'vitest';
import { entidadesDaLinearizacao, type EntidadeIcd11 } from './cid11';

/**
 * Recorte do que a API da OMS devolve em `/icd/release/11/{release}/mms/{id}`.
 *
 * Os codigos aqui sao SINTETICOS de proposito. O catalogo real e carregado da
 * OMS pelo script de ingestao; inventar codigo de CID em teste criaria uma
 * segunda fonte de verdade que ninguem lembraria de conferir.
 */
const RESPOSTA_OMS = {
  '@id': 'http://id.who.int/icd/release/11/2025-01/mms/999000001',
  code: 'ZZ00',
  title: { '@value': 'Termo sintetico de teste' },
  classKind: 'category',
  child: [
    'http://id.who.int/icd/release/11/2025-01/mms/999000002',
  ],
};

describe('entidadesDaLinearizacao', () => {
  it('extrai codigo, descricao e a URI da FUNDACAO, nao a do release', () => {
    const e = entidadesDaLinearizacao(RESPOSTA_OMS, '01');
    expect(e).toEqual<EntidadeIcd11[]>([{
      // A URI do release ('.../release/11/2025-01/mms/999000001') muda a cada
      // publicacao. A da fundacao ('.../entity/999000001') e a identidade que
      // sobrevive — e por isso a coluna `uri` guarda ela.
      uri: 'http://id.who.int/icd/entity/999000001',
      codigo: 'ZZ00',
      descricao: 'Termo sintetico de teste',
      capitulo: '01',
    }]);
  });

  it('descarta entidade sem codigo — capitulo e bloco nao sao diagnostico', () => {
    // `classKind: 'chapter'` e `'block'` agrupam mas nao codificam. Deixar
    // entrar poria "Capitulo 01" na lista de escolha do medico.
    const semCodigo = { ...RESPOSTA_OMS, code: undefined, classKind: 'block' };
    expect(entidadesDaLinearizacao(semCodigo, '01')).toEqual([]);
  });

  it('limpa marcacao do titulo que a OMS devolve embutida', () => {
    // A OMS marca o termo indexado com tags; o texto cru chegaria ao prontuario
    // com lixo no meio de um documento assinado.
    const comTag = {
      ...RESPOSTA_OMS,
      title: { '@value': 'Dor de cabeça <em class="found">tensional</em>' },
    };
    expect(entidadesDaLinearizacao(comTag, '08')[0]?.descricao)
      .toBe('Dor de cabeça tensional');
  });

  it('titulo ausente nao vira string vazia — a entidade e descartada', () => {
    // Descricao vazia no prontuario e pior que codigo ausente: o documento fica
    // com um diagnostico que nao diz nada.
    const semTitulo = { ...RESPOSTA_OMS, title: undefined };
    expect(entidadesDaLinearizacao(semTitulo, '01')).toEqual([]);
  });
});
