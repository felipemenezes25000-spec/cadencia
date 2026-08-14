import { describe, expect, it } from 'vitest';
import {
  DENTES_DECIDUOS, DENTES_PERMANENTES, ODONTOGRAMA_VAZIO,
  contarMarcados, dentesDaDenticao, ehAnterior, ehDenteValido,
  escreverOdontograma, lerOdontograma,
  type Odontograma,
} from './odontograma';

describe('numeracao FDI', () => {
  it('a arcada permanente tem 32 dentes e a decidua 20', () => {
    expect(DENTES_PERMANENTES).toHaveLength(32);
    expect(DENTES_DECIDUOS).toHaveLength(20);
  });

  it('nao ha numero repetido entre as duas arcadas', () => {
    const todos = [...DENTES_PERMANENTES, ...DENTES_DECIDUOS];
    expect(new Set(todos).size).toBe(todos.length);
  });

  it('reprova numero que nao existe na FDI', () => {
    for (const n of [0, 10, 19, 29, 49, 50, 56, 86, 99, -11]) {
      expect(ehDenteValido(n), `${n}`).toBe(false);
    }
    for (const n of [11, 18, 28, 48, 51, 55, 85]) {
      expect(ehDenteValido(n), `${n}`).toBe(true);
    }
  });

  it('incisivo e canino sao anteriores; pre-molar e molar nao', () => {
    /* Decide qual face o dente tem: anterior e incisal, posterior e oclusal.
       Errar aqui desenha face de mastigacao em incisivo. */
    expect(ehAnterior(11)).toBe(true);   // incisivo central
    expect(ehAnterior(13)).toBe(true);   // canino
    expect(ehAnterior(14)).toBe(false);  // 1o pre-molar
    expect(ehAnterior(16)).toBe(false);  // 1o molar
    expect(ehAnterior(51)).toBe(true);   // incisivo deciduo
    expect(ehAnterior(54)).toBe(false);  // molar deciduo
  });

  it('a denticao mista mostra as duas arcadas', () => {
    expect(dentesDaDenticao('permanente')).toHaveLength(32);
    expect(dentesDaDenticao('decidua')).toHaveLength(20);
    expect(dentesDaDenticao('mista')).toHaveLength(52);
  });
});

describe('leitura tolerante do value_json', () => {
  it('entrada vazia, nula ou em branco devolve odontograma vazio', () => {
    for (const v of [null, undefined, '', '   ']) {
      expect(lerOdontograma(v)).toEqual(ODONTOGRAMA_VAZIO);
    }
  });

  it('JSON corrompido NAO derruba a ficha — devolve vazio', () => {
    /* O campo vive dentro da ficha do paciente. Lancar aqui apagaria a tela
       inteira por causa de uma marcacao. */
    for (const v of ['{', 'nao é json', '[1,2,3]', 'null', '"texto"', '42']) {
      expect(lerOdontograma(v), v).toEqual(ODONTOGRAMA_VAZIO);
    }
  });

  it('descarta dente que nao existe na FDI', () => {
    const lido = lerOdontograma(JSON.stringify({
      denticao: 'permanente',
      dentes: { '11': { condicao: 'ausente' }, '99': { condicao: 'ausente' } },
    }));
    expect(Object.keys(lido.dentes)).toEqual(['11']);
  });

  it('descarta condicao e face fora do vocabulario', () => {
    const lido = lerOdontograma(JSON.stringify({
      dentes: {
        '11': { condicao: 'inventada', faces: { vestibular: 'carie', dorsal: 'carie', mesial: 'roxa' } },
      },
    }));
    expect(lido.dentes['11']).toEqual({ faces: { vestibular: 'carie' } });
  });

  it('dente que sobrou sem nada nao entra no mapa', () => {
    const lido = lerOdontograma(JSON.stringify({
      dentes: { '11': { condicao: 'inventada' }, '12': {} },
    }));
    expect(lido.dentes).toEqual({});
  });

  it('denticao invalida cai para permanente', () => {
    expect(lerOdontograma('{"denticao":"marciana","dentes":{}}').denticao).toBe('permanente');
    expect(lerOdontograma('{"denticao":"decidua","dentes":{}}').denticao).toBe('decidua');
  });

  it('trunca nota longa em vez de recusar o documento', () => {
    const lido = lerOdontograma(JSON.stringify({
      dentes: { '11': { nota: 'x'.repeat(900) } },
    }));
    expect(lido.dentes['11']?.nota).toHaveLength(500);
  });
});

describe('escrita', () => {
  it('ida e volta preserva o conteudo', () => {
    const o: Odontograma = {
      denticao: 'mista',
      dentes: {
        '16': { condicao: 'protese', faces: { oclusal: 'restauracao' } },
        '21': { faces: { mesial: 'carie', distal: 'carie' }, nota: 'acompanhar' },
        '51': { condicao: 'extracao_indicada' },
      },
    };
    expect(lerOdontograma(escreverOdontograma(o))).toEqual(o);
  });

  it('nao grava dente sem marcacao — o JSON guarda o afirmado, nao a arcada toda', () => {
    const o: Odontograma = {
      denticao: 'permanente',
      dentes: { '11': {}, '12': { faces: {} }, '13': { condicao: 'ausente' } },
    };
    const escrito = JSON.parse(escreverOdontograma(o)) as { dentes: Record<string, unknown> };
    expect(Object.keys(escrito.dentes)).toEqual(['13']);
  });

  it('odontograma vazio vira JSON pequeno e estavel', () => {
    expect(escreverOdontograma(ODONTOGRAMA_VAZIO)).toBe('{"denticao":"permanente","dentes":{}}');
  });

  it('conta os dentes marcados', () => {
    expect(contarMarcados(ODONTOGRAMA_VAZIO)).toBe(0);
    expect(contarMarcados(lerOdontograma(JSON.stringify({
      dentes: { '11': { condicao: 'ausente' }, '12': { faces: { oclusal: 'carie' } } },
    })))).toBe(2);
  });
});
