import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serializeRecursoGlosa } from './serialize-recurso-glosa';
import type { RecursoGlosaInput } from './types';

/**
 * Recurso de glosa de amostra DETERMINISTICO — os mesmos dados sempre, para
 * que o snapshot byte a byte seja reproduzivel. Nenhum campo depende de relogio.
 */
function recursoAmostraDeterministico(): RecursoGlosaInput {
  return {
    cabecalho: {
      versaoPadrao: '4.01.00',
      registroANS: '339679',
      dataGeracao: '2026-08-07',
      horaGeracao: '14:30:00',
      sequencialTransacao: '12345',
    },
    registroANS: '339679',
    numeroLoteOriginal: '0001',
    numeroRecursoGlosa: 'RG0001',
    contratado: {
      cnpjContratado: '11222333000181',
      cnes: '1234567',
    },
    itens: [
      {
        sequencialItem: '1',
        dataAtendimento: '2026-08-05',
        numeroGuiaPrestador: '00001',
        numeroGuiaOperadora: 'OP98765',
        codigoProcedimento: '10101012',
        codigoGlosa: 'A10',
        valorRecursadoCentavos: 15000,
        justificativa: 'Procedimento realizado conforme indicação clínica documentada',
      },
      {
        sequencialItem: '2',
        dataAtendimento: '2026-07-15',
        numeroGuiaPrestador: '00002',
        codigoProcedimento: '10101039',
        codigoGlosa: 'B15',
        valorRecursadoCentavos: 8050,
        justificativa: 'Exame necessário para diagnóstico diferencial',
      },
    ],
    encounterVersionId: 'ev_00000000-0000-0000-0000-000000000001',
  };
}

const FIXTURE_DIR = join(__dirname, '../../test/fixtures');
const FIXTURE_PATH = join(FIXTURE_DIR, 'recurso-glosa-amostra.xml');

describe('snapshot byte a byte do recurso de glosa', () => {
  it('gera XML deterministico e identico ao snapshot congelado', () => {
    const { xml, warnings } = serializeRecursoGlosa(recursoAmostraDeterministico());
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

    const expected = new Uint8Array(readFileSync(FIXTURE_PATH));
    expect(xml.byteLength).toBe(expected.byteLength);

    // Comparacao byte a byte com diagnostico util
    for (let i = 0; i < xml.byteLength; i++) {
      if (xml[i] !== expected[i]) {
        const context = new TextDecoder('iso-8859-1').decode(
          xml.slice(Math.max(0, i - 20), i + 20),
        );
        throw new Error(
          `Divergencia no byte ${i}: esperado 0x${expected[i]!.toString(16).padStart(2, '0')} ` +
          `mas recebeu 0x${xml[i]!.toString(16).padStart(2, '0')}. ` +
          `Contexto: ...${context}...`,
        );
      }
    }
  });

  it('o XML do snapshot e valido como texto ISO-8859-1', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostraDeterministico());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<?xml version="1.0" encoding="ISO-8859-1"?>');
    expect(text).toContain('</ans:mensagemTISS>');
    // Verifica que o acento em "indicacao" foi preservado em ISO-8859-1
    expect(text).toContain('indicação');
  });

  it('duas chamadas com os mesmos dados produzem bytes identicos', () => {
    const result1 = serializeRecursoGlosa(recursoAmostraDeterministico());
    const result2 = serializeRecursoGlosa(recursoAmostraDeterministico());
    expect(result1.xml).toEqual(result2.xml);
  });
});
