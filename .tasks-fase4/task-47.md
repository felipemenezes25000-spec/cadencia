### Task 47: teste de validacao com xmllint e XSD de amostra

**Arquivos**

- Criar `packages/tiss/test/fixtures/tiss-sample.xsd` (XSD minimo de amostra)
- Teste `packages/tiss/src/serializer/xmllint.test.ts`

**Passos**

- [ ] Criar o XSD de amostra `packages/tiss/test/fixtures/tiss-sample.xsd`. Este XSD e uma versao SIMPLIFICADA do padrao TISS para validacao estrutural — nao substitui o XSD oficial da ANS, que deve ser usado em homologacao:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas"
           targetNamespace="http://www.ans.gov.br/padroes/tiss/schemas"
           elementFormDefault="qualified">

  <xs:element name="mensagemTISS">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="cabecalho" type="ans:cabecalhoType"/>
        <xs:element name="prestadorParaOperadora" type="ans:prestadorParaOperadoraType"/>
        <xs:element name="epilogo" type="ans:epilogoType"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>

  <xs:complexType name="cabecalhoType">
    <xs:sequence>
      <xs:element name="versaoPadrao" type="xs:string"/>
      <xs:element name="registroANS" type="xs:string"/>
      <xs:element name="dataGeracao" type="xs:string"/>
      <xs:element name="horaGeracao" type="xs:string"/>
      <xs:element name="sequencialTransacao" type="xs:string"/>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="prestadorParaOperadoraType">
    <xs:sequence>
      <xs:element name="loteGuias" type="ans:loteGuiasType"/>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="loteGuiasType">
    <xs:sequence>
      <xs:element name="numeroLote" type="xs:string"/>
      <xs:element name="guiaConsulta" type="ans:guiaConsultaType" maxOccurs="unbounded"/>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="guiaConsultaType">
    <xs:sequence>
      <xs:element name="numeroGuiaPrestador" type="xs:string"/>
      <xs:element name="numeroGuiaOperadora" type="xs:string" minOccurs="0"/>
      <xs:element name="numeroCarteira" type="xs:string"/>
      <xs:element name="atendimentoRN" type="xs:string"/>
      <xs:element name="dadosContratado" type="ans:dadosContratadoType"/>
      <xs:element name="profissionalExecutante" type="ans:profissionalExecutanteType"/>
      <xs:element name="indicacaoAcidente" type="xs:string"/>
      <xs:element name="regimeAtendimento" type="xs:string"/>
      <xs:element name="saudeOcupacional" type="xs:string" minOccurs="0"/>
      <xs:element name="coberturaEspecial" type="xs:string" minOccurs="0"/>
      <xs:element name="dataAtendimento" type="xs:string"/>
      <xs:element name="tipoConsulta" type="xs:string"/>
      <xs:element name="codigoTabela" type="xs:string"/>
      <xs:element name="codigoProcedimento" type="xs:string"/>
      <xs:element name="valorProcedimento" type="xs:string"/>
      <xs:element name="observacao" type="xs:string" minOccurs="0"/>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="dadosContratadoType">
    <xs:sequence>
      <xs:element name="codigoPrestadorNaOperadora" type="xs:string" minOccurs="0"/>
      <xs:element name="cpfContratado" type="xs:string" minOccurs="0"/>
      <xs:element name="cnpjContratado" type="xs:string" minOccurs="0"/>
      <xs:element name="CNES" type="xs:string"/>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="profissionalExecutanteType">
    <xs:sequence>
      <xs:element name="conselhoProfissional" type="xs:string"/>
      <xs:element name="numeroConselho" type="xs:string"/>
      <xs:element name="ufConselho" type="xs:string"/>
      <xs:element name="CBOS" type="xs:string"/>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="epilogoType">
    <xs:sequence>
      <xs:element name="hash" type="xs:string"/>
    </xs:sequence>
  </xs:complexType>

</xs:schema>
```

- [ ] Criar o teste `packages/tiss/src/serializer/xmllint.test.ts`:

```ts
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
        observacao: 'Paciente com press\u00E3o elevada',
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
      const result = execSync(
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
```

- [ ] Rodar os testes:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && pnpm vitest run packages/tiss/src/serializer/xmllint.test.ts
```

Saida esperada: 2 testes passando (se xmllint estiver instalado) ou 2 testes passando com mensagem de SKIP (se xmllint nao estiver disponivel).

- [ ] Commitar:

```bash
git add packages/tiss/test/fixtures/tiss-sample.xsd packages/tiss/src/serializer/xmllint.test.ts
git commit -m "test(tiss): add XSD validation with xmllint for generated TISS XML"
```

---