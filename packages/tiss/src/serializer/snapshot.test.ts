import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serializeLoteConsulta } from './serialize-lote-consulta';
import { validarContraXsdTiss } from '../../test/xsd';
import type { LoteConsultaInput } from './types';

/**
 * Lote de amostra DETERMINISTICO — os mesmos dados sempre, para que o
 * snapshot byte a byte seja reproduzivel. Nenhum campo depende de relogio.
 */
function loteAmostraDeterministico(): LoteConsultaInput {
  return {
    cabecalho: {
      versaoPadrao: '4.01.00',
      registroANS: '339679',
      dataGeracao: '2026-08-07',
      horaGeracao: '14:30:00',
      sequencialTransacao: '12345',
    },
    registroANS: '339679',
    numeroLote: '0001',
    guias: [
      {
        registroANSOperadora: '123456',
        numeroGuiaPrestador: '00001',
        numeroGuiaOperadora: 'OP98765',
        numeroCarteira: '98765432101234567',
        atendimentoRN: false,
        contratado: {
          cnpjContratado: '11222333000181',
          cnes: '1234567',
        },
        profissionalExecutante: {
          conselhoProfissional: '06',
          numeroConselho: '123456',
          ufConselho: '35',
          cbos: '225120',
        },
        indicacaoAcidente: '9',
        regimeAtendimento: '01',
        dataAtendimento: '2026-08-05',
        tipoConsulta: '1',
        codigoTabela: '22',
        codigoProcedimento: '10101012',
        valorProcedimentoCentavos: 15000,
        observacao: 'Paciente com pressão elevada',
      },
      {
        registroANSOperadora: '123456',
        numeroGuiaPrestador: '00002',
        numeroCarteira: '11111111111111111',
        atendimentoRN: true,
        contratado: {
          codigoPrestadorNaOperadora: 'PREST001',
          cnes: '7654321',
        },
        profissionalExecutante: {
          conselhoProfissional: '06',
          numeroConselho: '654321',
          ufConselho: '33',
          cbos: '225120',
        },
        indicacaoAcidente: '0',
        regimeAtendimento: '01',
        saudeOcupacional: '01',
        coberturaEspecial: '01',
        dataAtendimento: '2026-07-15',
        tipoConsulta: '2',
        codigoTabela: '22',
        codigoProcedimento: '10101039',
        valorProcedimentoCentavos: 8050,
      },
    ],
  };
}

const FIXTURE_DIR = join(__dirname, '../../test/fixtures');
const FIXTURE_PATH = join(FIXTURE_DIR, 'lote-consulta-amostra.xml');

describe('snapshot byte a byte do lote de consulta', () => {
  it('gera XML deterministico e identico ao snapshot congelado', () => {
    const { xml, warnings } = serializeLoteConsulta(loteAmostraDeterministico());
    expect(warnings).toEqual([]);

    if (!existsSync(FIXTURE_PATH)) {
      // Primeira execucao: cria o snapshot
      if (!existsSync(FIXTURE_DIR)) {
        mkdirSync(FIXTURE_DIR, { recursive: true });
      }
      writeFileSync(FIXTURE_PATH, xml);
      // eslint-disable-next-line no-console
      console.log(`Snapshot criado: ${FIXTURE_PATH} (${xml.byteLength} bytes)`);
      // NAO falha na primeira execucao — o snapshot acabou de ser criado.
    }

    // O snapshot congelado tem de ser, ele proprio, XML VALIDO pela norma.
    //
    // Sem esta ancora o teste vira um espelho: alguem regenera o fixture depois
    // de uma mudanca errada e ele volta a passar, congelando o defeito. Foi
    // exatamente o que aconteceu ate aqui — o fixture anterior guardava um
    // cabecalho plano que nenhuma operadora aceitaria, e o snapshot dizia
    // "identico", porque era identico a si mesmo.
    const doFixture = validarContraXsdTiss(new Uint8Array(readFileSync(FIXTURE_PATH)));
    expect(doFixture.erros.join('\n')).toBe('');

    const expected = new Uint8Array(readFileSync(FIXTURE_PATH));
    expect(xml.byteLength).toBe(expected.byteLength);

    // Comparacao byte a byte com diagnostico util
    for (let i = 0; i < xml.byteLength; i++) {
      if (xml[i] !== expected[i]) {
        const context = new TextDecoder('iso-8859-1').decode(xml.slice(Math.max(0, i - 20), i + 20));
        throw new Error(
          `Divergencia no byte ${i}: esperado 0x${expected[i]!.toString(16).padStart(2, '0')} ` +
          `mas recebeu 0x${xml[i]!.toString(16).padStart(2, '0')}. ` +
          `Contexto: ...${context}...`,
        );
      }
    }
  });

  it('o XML do snapshot e valido como texto ISO-8859-1', () => {
    const { xml } = serializeLoteConsulta(loteAmostraDeterministico());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<?xml version="1.0" encoding="ISO-8859-1"?>');
    expect(text).toContain('</ans:mensagemTISS>');
    // Verifica que o acento em "pressao" foi preservado em ISO-8859-1
    expect(text).toContain('pressão');
  });

  it('duas chamadas com os mesmos dados produzem bytes identicos', () => {
    const result1 = serializeLoteConsulta(loteAmostraDeterministico());
    const result2 = serializeLoteConsulta(loteAmostraDeterministico());
    expect(result1.xml).toEqual(result2.xml);
  });
});
