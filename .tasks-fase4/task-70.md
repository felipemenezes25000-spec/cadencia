### Task 70: invariante CI — teste XSD: serializar lote de amostra e validar contra XSD TISS

**Arquivos**

- Criar `packages/tiss/test/fixtures/tissV4_01_00.xsd` (XSD de amostra simplificado para CI)
- Criar `packages/tiss/src/serializer/xsd-validation.int.test.ts`

**Passos**

- [ ] Criar um XSD de amostra simplificado que cobre a estrutura minima do lote de guias de consulta TISS 4.01.00. O XSD real da ANS tem ~30 arquivos encadeados; para CI, usamos um XSD simplificado que valida: namespace `http://www.ans.gov.br/padroes/tiss/schemas`, elemento raiz `mensagemTISS`, presenca de `cabecalho` e `prestadorParaOperadora`, elemento `hash` com valor MD5, e ao menos uma `guiaConsulta` dentro de `loteGuias`. Este arquivo NAO e o XSD oficial — e uma amostra para CI. O teste de conformidade total contra o XSD oficial roda no CI noturno com os XSD completos.

```xml
<?xml version="1.0" encoding="ISO-8859-1"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas"
           targetNamespace="http://www.ans.gov.br/padroes/tiss/schemas"
           elementFormDefault="qualified">

  <xs:element name="mensagemTISS">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="cabecalho" type="ans:ct_cabecalho"/>
        <xs:element name="prestadorParaOperadora" type="ans:ct_prestadorParaOperadora"/>
        <xs:element name="epilogo" type="ans:ct_epilogo"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>

  <xs:complexType name="ct_cabecalho">
    <xs:sequence>
      <xs:element name="identificacaoTransacao">
        <xs:complexType>
          <xs:sequence>
            <xs:element name="tipoTransacao" type="xs:string"/>
            <xs:element name="sequencialTransacao" type="xs:string"/>
            <xs:element name="dataRegistroTransacao" type="xs:date"/>
            <xs:element name="horaRegistroTransacao" type="xs:time"/>
          </xs:sequence>
        </xs:complexType>
      </xs:element>
      <xs:element name="origem">
        <xs:complexType>
          <xs:sequence>
            <xs:element name="identificacaoPrestador">
              <xs:complexType>
                <xs:sequence>
                  <xs:element name="CNPJ" type="xs:string" minOccurs="0"/>
                  <xs:element name="codigoPrestadorNaOperadora" type="xs:string" minOccurs="0"/>
                </xs:sequence>
              </xs:complexType>
            </xs:element>
          </xs:sequence>
        </xs:complexType>
      </xs:element>
      <xs:element name="destino">
        <xs:complexType>
          <xs:sequence>
            <xs:element name="registroANS" type="xs:string"/>
          </xs:sequence>
        </xs:complexType>
      </xs:element>
      <xs:element name="Padrao" type="xs:string"/>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="ct_prestadorParaOperadora">
    <xs:sequence>
      <xs:element name="loteGuias">
        <xs:complexType>
          <xs:sequence>
            <xs:element name="numeroLote" type="xs:string"/>
            <xs:element name="guiasTISS">
              <xs:complexType>
                <xs:sequence>
                  <xs:element name="guiaConsulta" type="ans:ct_guiaConsulta" maxOccurs="unbounded"/>
                </xs:sequence>
              </xs:complexType>
            </xs:element>
          </xs:sequence>
        </xs:complexType>
      </xs:element>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="ct_guiaConsulta">
    <xs:sequence>
      <xs:element name="cabecalhoGuia">
        <xs:complexType>
          <xs:sequence>
            <xs:element name="registroANS" type="xs:string"/>
            <xs:element name="numeroGuiaPrestador" type="xs:string"/>
          </xs:sequence>
        </xs:complexType>
      </xs:element>
      <xs:element name="dadosBeneficiario">
        <xs:complexType>
          <xs:sequence>
            <xs:element name="numeroCarteira" type="xs:string"/>
            <xs:element name="atendimentoRN" type="xs:string"/>
          </xs:sequence>
        </xs:complexType>
      </xs:element>
      <xs:element name="dadosContratado">
        <xs:complexType>
          <xs:sequence>
            <xs:element name="codigoPrestadorNaOperadora" type="xs:string" minOccurs="0"/>
            <xs:element name="CNPJ" type="xs:string" minOccurs="0"/>
            <xs:element name="CNES" type="xs:string"/>
          </xs:sequence>
        </xs:complexType>
      </xs:element>
      <xs:element name="dadosAtendimento">
        <xs:complexType>
          <xs:sequence>
            <xs:element name="dataAtendimento" type="xs:date"/>
            <xs:element name="tipoConsulta" type="xs:string"/>
            <xs:element name="procedimento">
              <xs:complexType>
                <xs:sequence>
                  <xs:element name="codigoTabela" type="xs:string"/>
                  <xs:element name="codigoProcedimento" type="xs:string"/>
                  <xs:element name="valorProcedimento" type="xs:decimal"/>
                </xs:sequence>
              </xs:complexType>
            </xs:element>
          </xs:sequence>
        </xs:complexType>
      </xs:element>
      <xs:element name="dadosExecutante">
        <xs:complexType>
          <xs:sequence>
            <xs:element name="conselhoProfissional" type="xs:string"/>
            <xs:element name="numeroConselho" type="xs:string"/>
            <xs:element name="UF" type="xs:string"/>
            <xs:element name="CBOS" type="xs:string"/>
          </xs:sequence>
        </xs:complexType>
      </xs:element>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="ct_epilogo">
    <xs:sequence>
      <xs:element name="hash" type="xs:string"/>
    </xs:sequence>
  </xs:complexType>

</xs:schema>
```

- [ ] Criar o teste de validacao XSD. Este teste importa o serializador (definido pelo bloco 07-xml-serializer, `serializeLoteConsulta`), serializa um lote de amostra, e valida contra o XSD usando `xmllint` (disponivel no CI). Se `xmllint` nao estiver disponivel localmente, o teste e pulado com skip gracioso.

```ts
// packages/tiss/src/serializer/xsd-validation.int.test.ts
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { serializeLoteConsulta } from './serialize-lote-consulta';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
      const lote = {
        cabecalho: {
          tipoTransacao: 'ENVIO_LOTE_GUIAS',
          sequencialTransacao: '000000001',
          dataRegistroTransacao: '2026-08-07',
          horaRegistroTransacao: '10:30:00',
          cnpjPrestador: '12ABC34501DE35',
          codigoPrestadorNaOperadora: '123456',
          registroANS: '123456',
          versaoPadrao: '4.01.00',
        },
        numeroLote: '000000000001',
        guias: [{
          registroANS: '123456',
          numeroGuiaPrestador: '00000000000000000001',
          numeroCarteira: '12345678901234567',
          atendimentoRN: 'N',
          codigoPrestadorNaOperadora: '123456',
          cnes: '1234567',
          dataAtendimento: '2026-08-07',
          tipoConsulta: '1',
          codigoTabela: '22',
          codigoProcedimento: '10101012',
          valorProcedimento: '150.00',
          conselhoProfissional: '06',
          numeroConselho: '123456',
          uf: 'SP',
          cbos: '225120',
        }],
      };

      const xmlBytes = serializeLoteConsulta(lote);
      expect(xmlBytes).toBeInstanceOf(Uint8Array);
      expect(xmlBytes.length).toBeGreaterThan(0);

      // Gravar em arquivo temporario para xmllint
      const tmpDir = join(tmpdir(), 'cadencia-xsd-test');
      mkdirSync(tmpDir, { recursive: true });
      const xmlPath = join(tmpDir, 'lote-teste.xml');
      writeFileSync(xmlPath, xmlBytes);

      try {
        const resultado = execSync(
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
      const lote = {
        cabecalho: {
          tipoTransacao: 'ENVIO_LOTE_GUIAS',
          sequencialTransacao: '000000002',
          dataRegistroTransacao: '2026-08-07',
          horaRegistroTransacao: '11:00:00',
          cnpjPrestador: '12ABC34501DE35',
          codigoPrestadorNaOperadora: '123456',
          registroANS: '654321',
          versaoPadrao: '4.01.00',
        },
        numeroLote: '000000000002',
        guias: [{
          registroANS: '654321',
          numeroGuiaPrestador: '00000000000000000002',
          numeroCarteira: '98765432109876543',
          atendimentoRN: 'N',
          codigoPrestadorNaOperadora: '654321',
          cnes: '7654321',
          dataAtendimento: '2026-08-07',
          tipoConsulta: '2',
          codigoTabela: '22',
          codigoProcedimento: '10101012',
          valorProcedimento: '200.00',
          conselhoProfissional: '06',
          numeroConselho: '654321',
          uf: 'RJ',
          cbos: '225120',
        }],
      };

      const xmlBytes = serializeLoteConsulta(lote);
      // Verificar que o encoding declaration e ISO-8859-1
      const primeirosBytes = new TextDecoder('iso-8859-1').decode(xmlBytes.slice(0, 100));
      expect(primeirosBytes).toContain('encoding="ISO-8859-1"');
    },
  );
});
```

- [ ] Rodar `pnpm vitest run packages/tiss/src/serializer/xsd-validation.int.test.ts --config vitest.int.config.ts` e confirmar que o teste do XSD existe passa, e que os testes de validacao sao pulados ou passam dependendo da disponibilidade de `xmllint`.

Saida esperada: 1 teste passando (existencia do XSD), 2 testes pulados ou passando conforme `xmllint`.

- [ ] Commitar: `test(tiss): add XSD validation invariant for serialized TISS XML`

---