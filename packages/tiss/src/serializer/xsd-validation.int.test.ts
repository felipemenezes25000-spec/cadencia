// packages/tiss/src/serializer/xsd-validation.int.test.ts
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { serializeLoteConsulta } from './serialize-lote-consulta';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LoteConsultaInput } from './types';

function xmllintDisponivel(): boolean {
  try {
    execSync('xmllint --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const XSD_PATH = resolve(import.meta.dirname, '../../test/fixtures/tissV4_01_00.xsd');

describe('invariante CI — validacao XSD do XML TISS serializado', () => {
  it('o XSD de amostra existe no repositorio', () => {
    expect(existsSync(XSD_PATH)).toBe(true);
  });

  it.skipIf(!xmllintDisponivel())(
    'o XML serializado valida contra o XSD TISS 4.01.00 de amostra',
    () => {
      // Lote de amostra com uma guia de consulta
      const lote: LoteConsultaInput = {
        cabecalho: {
          versaoPadrao: '4.01.00',
          registroANS: '123456',
          dataGeracao: '2026-08-07',
          horaGeracao: '10:30:00',
          sequencialTransacao: '000000001',
        },
        registroANS: '123456',
        numeroLote: '000000000001',
        guias: [{
          numeroGuiaPrestador: '00000000000000000001',
          numeroCarteira: '12345678901234567',
          atendimentoRN: false,
          contratado: {
            cnpjContratado: '12ABC34501DE35',
            codigoPrestadorNaOperadora: '123456',
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
          dataAtendimento: '2026-08-07',
          tipoConsulta: '1',
          codigoTabela: '22',
          codigoProcedimento: '10101012',
          valorProcedimentoCentavos: 15000,
        }],
      };

      const { xml, warnings } = serializeLoteConsulta(lote);
      expect(xml).toBeInstanceOf(Uint8Array);
      expect(xml.length).toBeGreaterThan(0);
      expect(warnings).toEqual([]);

      // Gravar em arquivo temporario para xmllint
      const tmpDir = join(tmpdir(), 'cadencia-xsd-test');
      mkdirSync(tmpDir, { recursive: true });
      const xmlPath = join(tmpDir, 'lote-teste.xml');
      writeFileSync(xmlPath, xml);

      try {
        execSync(
          `xmllint --noout --schema "${XSD_PATH}" "${xmlPath}"`,
          { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
        );
        // xmllint retorna exit 0 se valido, o expect acima nao lancar e suficiente
      } catch (error: unknown) {
        const msg = error instanceof Error
          ? (error as { stderr?: string }).stderr ?? error.message
          : String(error);
        expect.fail(`XML nao validou contra o XSD:\n${msg}`);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!xmllintDisponivel())(
    'o XML serializado usa encoding ISO-8859-1 e preserva acentos',
    () => {
      const lote: LoteConsultaInput = {
        cabecalho: {
          versaoPadrao: '4.01.00',
          registroANS: '654321',
          dataGeracao: '2026-08-07',
          horaGeracao: '11:00:00',
          sequencialTransacao: '000000002',
        },
        registroANS: '654321',
        numeroLote: '000000000002',
        guias: [{
          numeroGuiaPrestador: '00000000000000000002',
          numeroCarteira: '98765432109876543',
          atendimentoRN: false,
          contratado: {
            cnpjContratado: '12ABC34501DE35',
            codigoPrestadorNaOperadora: '654321',
            cnes: '7654321',
          },
          profissionalExecutante: {
            conselhoProfissional: '06',
            numeroConselho: '654321',
            ufConselho: 'RJ',
            cbos: '225120',
          },
          indicacaoAcidente: '9',
          regimeAtendimento: '01',
          dataAtendimento: '2026-08-07',
          tipoConsulta: '2',
          codigoTabela: '22',
          codigoProcedimento: '10101012',
          valorProcedimentoCentavos: 20000,
        }],
      };

      const { xml } = serializeLoteConsulta(lote);
      // Verificar que o encoding declaration e ISO-8859-1
      const primeirosBytes = new TextDecoder('iso-8859-1').decode(xml.slice(0, 100));
      expect(primeirosBytes).toContain('encoding="ISO-8859-1"');
    },
  );
});
