import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serializeLoteConsulta } from './serialize-lote-consulta';
import type { LoteConsultaInput } from './types';

/**
 * Valida o XML gerado contra o XSD de amostra usando xmllint.
 * Este teste e PULADO automaticamente se xmllint nao estiver instalado.
 */

function xmllintDisponivel(): boolean {
  try {
    execSync('xmllint --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function loteAmostra(): LoteConsultaInput {
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
        numeroGuiaPrestador: '00001',
        numeroCarteira: '98765432101234567',
        atendimentoRN: false,
        contratado: {
          cnpjContratado: '11222333000181',
          cnes: '1234567',
        },
        profissionalExecutante: {
          conselhoProfissional: '06',
          numeroConselho: '123456',
          ufConselho: 'SP',
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
    ],
  };
}

const SCRATCHPAD = join(__dirname, '../../test/fixtures');
const XSD_PATH = join(SCRATCHPAD, 'tiss-sample.xsd');
const TMP_XML = join(SCRATCHPAD, 'xmllint-test-temp.xml');

describe('validacao XML com xmllint', () => {
  const skipMsg = 'xmllint nao esta disponivel neste ambiente';

  it('XML gerado e valido contra o XSD de amostra', () => {
    if (!xmllintDisponivel()) {
      // eslint-disable-next-line no-console
      console.log(`SKIP: ${skipMsg}`);
      return;
    }

    const { xml, warnings } = serializeLoteConsulta(loteAmostra());
    expect(warnings).toEqual([]);

    // Escreve XML temporario para xmllint
    if (!existsSync(SCRATCHPAD)) {
      mkdirSync(SCRATCHPAD, { recursive: true });
    }
    writeFileSync(TMP_XML, xml);

    try {
      execSync(
        `xmllint --noout --schema "${XSD_PATH}" "${TMP_XML}"`,
        { stdio: 'pipe', encoding: 'utf8' },
      );
      // xmllint saiu com codigo 0: XML valido
      expect(true).toBe(true);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`xmllint falhou na validacao:\n${message}`);
    } finally {
      try { unlinkSync(TMP_XML); } catch { /* arquivo ja foi removido */ }
    }
  });

  it('XML gerado e well-formed (xmllint sem schema)', () => {
    if (!xmllintDisponivel()) {
      // eslint-disable-next-line no-console
      console.log(`SKIP: ${skipMsg}`);
      return;
    }

    const { xml } = serializeLoteConsulta(loteAmostra());

    if (!existsSync(SCRATCHPAD)) {
      mkdirSync(SCRATCHPAD, { recursive: true });
    }
    writeFileSync(TMP_XML, xml);

    try {
      execSync(`xmllint --noout "${TMP_XML}"`, { stdio: 'pipe', encoding: 'utf8' });
      expect(true).toBe(true);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`xmllint well-formedness falhou:\n${message}`);
    } finally {
      try { unlinkSync(TMP_XML); } catch { /* arquivo ja foi removido */ }
    }
  });
});
