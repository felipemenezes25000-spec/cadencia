### Task 45: serialize-lote-consulta — monta XML completo do lote de guias

**Arquivos**

- Criar `packages/tiss/src/serializer/serialize-lote-consulta.ts`
- Teste `packages/tiss/src/serializer/serialize-lote-consulta.test.ts`

**Passos**

- [ ] Criar o teste `packages/tiss/src/serializer/serialize-lote-consulta.test.ts` (TDD):

```ts
import { describe, expect, it } from 'vitest';
import { serializeLoteConsulta } from './serialize-lote-consulta';
import type { LoteConsultaInput } from './types';

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
      },
    ],
  };
}

describe('serializeLoteConsulta', () => {
  it('retorna Uint8Array (bytes ISO-8859-1, nao string)', () => {
    const result = serializeLoteConsulta(loteAmostra());
    expect(result.xml).toBeInstanceOf(Uint8Array);
    expect(result.warnings).toEqual([]);
  });

  it('comeca com declaracao XML encoding ISO-8859-1', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const decoder = new TextDecoder('iso-8859-1');
    const text = decoder.decode(xml);
    expect(text.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>')).toBe(true);
  });

  it('contem namespace ans correto na raiz', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas"');
  });

  it('contem tag ans:mensagemTISS como raiz', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:mensagemTISS');
    expect(text).toContain('</ans:mensagemTISS>');
  });

  it('contem cabecalho com todos os campos', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:versaoPadrao>4.01.00</ans:versaoPadrao>');
    expect(text).toContain('<ans:registroANS>339679</ans:registroANS>');
    expect(text).toContain('<ans:dataGeracao>2026-08-07</ans:dataGeracao>');
    expect(text).toContain('<ans:horaGeracao>14:30:00</ans:horaGeracao>');
    expect(text).toContain('<ans:sequencialTransacao>12345</ans:sequencialTransacao>');
  });

  it('contem tag ans:hash com hash MD5 proprietario', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    const hashMatch = text.match(/<ans:hash>([0-9a-f]{32})<\/ans:hash>/);
    expect(hashMatch).not.toBeNull();
  });

  it('contem numero do lote', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:numeroLote>0001</ans:numeroLote>');
  });

  it('contem dados da guia de consulta', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:numeroGuiaPrestador>00001</ans:numeroGuiaPrestador>');
    expect(text).toContain('<ans:numeroCarteira>98765432101234567</ans:numeroCarteira>');
    expect(text).toContain('<ans:atendimentoRN>N</ans:atendimentoRN>');
    expect(text).toContain('<ans:CNES>1234567</ans:CNES>');
    expect(text).toContain('<ans:codigoTabela>22</ans:codigoTabela>');
    expect(text).toContain('<ans:codigoProcedimento>10101012</ans:codigoProcedimento>');
    expect(text).toContain('<ans:valorProcedimento>150.00</ans:valorProcedimento>');
  });

  it('serializa atendimentoRN como S/N (booleano TISS)', () => {
    const lote = loteAmostra();
    const guiaRN = { ...lote.guias[0], atendimentoRN: true };
    const { xml } = serializeLoteConsulta({ ...lote, guias: [guiaRN] });
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:atendimentoRN>S</ans:atendimentoRN>');
  });

  it('omite tags opcionais quando campo e undefined', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    // guia da amostra nao tem observacao, guia operadora, saude ocupacional, cobertura especial
    expect(text).not.toContain('<ans:observacao>');
    expect(text).not.toContain('<ans:numeroGuiaOperadora>');
    expect(text).not.toContain('<ans:saudeOcupacional>');
    expect(text).not.toContain('<ans:coberturaEspecial>');
  });

  it('inclui tags opcionais quando campo esta presente', () => {
    const lote = loteAmostra();
    const guia = {
      ...lote.guias[0],
      numeroGuiaOperadora: 'OP12345',
      observacao: 'Retorno em 30 dias',
      saudeOcupacional: '1',
      coberturaEspecial: '0',
    };
    const { xml } = serializeLoteConsulta({ ...lote, guias: [guia] });
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:numeroGuiaOperadora>OP12345</ans:numeroGuiaOperadora>');
    expect(text).toContain('<ans:observacao>Retorno em 30 dias</ans:observacao>');
    expect(text).toContain('<ans:saudeOcupacional>1</ans:saudeOcupacional>');
    expect(text).toContain('<ans:coberturaEspecial>0</ans:coberturaEspecial>');
  });

  it('serializa contratado com CNPJ quando cnpjContratado presente', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:cnpjContratado>11222333000181</ans:cnpjContratado>');
    expect(text).not.toContain('<ans:cpfContratado>');
    expect(text).not.toContain('<ans:codigoPrestadorNaOperadora>');
  });

  it('serializa contratado com CPF quando cpfContratado presente', () => {
    const lote = loteAmostra();
    const guia = {
      ...lote.guias[0],
      contratado: { cpfContratado: '12345678901', cnes: '1234567' },
    };
    const { xml } = serializeLoteConsulta({ ...lote, guias: [guia] });
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:cpfContratado>12345678901</ans:cpfContratado>');
    expect(text).not.toContain('<ans:cnpjContratado>');
  });

  it('serializa multiplas guias no mesmo lote', () => {
    const lote = loteAmostra();
    const guia2 = {
      ...lote.guias[0],
      numeroGuiaPrestador: '00002',
      valorProcedimentoCentavos: 20000,
    };
    const { xml } = serializeLoteConsulta({ ...lote, guias: [lote.guias[0], guia2] });
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:numeroGuiaPrestador>00001</ans:numeroGuiaPrestador>');
    expect(text).toContain('<ans:numeroGuiaPrestador>00002</ans:numeroGuiaPrestador>');
    expect(text).toContain('<ans:valorProcedimento>200.00</ans:valorProcedimento>');
  });

  it('escapa entidades XML em campo de observacao', () => {
    const lote = loteAmostra();
    const guia = {
      ...lote.guias[0],
      observacao: 'PA > 14 & FC < 100 "normal"',
    };
    const { xml } = serializeLoteConsulta({ ...lote, guias: [guia] });
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain(
      '<ans:observacao>PA &gt; 14 &amp; FC &lt; 100 &quot;normal&quot;</ans:observacao>',
    );
  });
});
```

- [ ] Rodar e confirmar falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && pnpm vitest run packages/tiss/src/serializer/serialize-lote-consulta.test.ts
```

Saida esperada: falha — `Cannot find module './serialize-lote-consulta'`.

- [ ] Criar a implementacao `packages/tiss/src/serializer/serialize-lote-consulta.ts`:

```ts
import { XmlBuilder } from './xml-builder';
import { encodeIso8859 } from './encode-iso8859';
import { computeTissHash } from './compute-tiss-hash';
import type { LoteConsultaInput, GuiaConsultaInput } from './types';

/**
 * Resultado da serializacao de um lote de consulta TISS.
 */
export interface SerializeLoteResult {
  /** XML completo em bytes ISO-8859-1, pronto para envio. */
  readonly xml: Uint8Array;
  /** Warnings de caracteres nao mapeados para ISO-8859-1. */
  readonly warnings: readonly string[];
}

/**
 * Serializa um lote de guias de consulta TISS em XML ISO-8859-1.
 *
 * Funcao PURA: recebe dados tipados, devolve Uint8Array. ZERO side-effect.
 * O hash MD5 proprietario e calculado e embutido em <ans:hash>.
 * O XML segue o padrao TISS 4.01.00 (ou a versao do lote).
 */
export function serializeLoteConsulta(input: LoteConsultaInput): SerializeLoteResult {
  const { cabecalho, numeroLote, guias } = input;

  // Calcula o hash antes de montar o XML — ele sera embutido no epilogo
  const hash = computeTissHash(cabecalho, numeroLote, guias);

  const xml = new XmlBuilder();

  // Raiz com namespace ANS
  xml.openWithAttrs('ans:mensagemTISS', {
    'xmlns:ans': 'http://www.ans.gov.br/padroes/tiss/schemas',
  });

  // ---- Cabecalho ----
  emitCabecalho(xml, cabecalho);

  // ---- Corpo: prestadorParaOperadora > loteGuias ----
  xml.open('ans:prestadorParaOperadora');
  xml.open('ans:loteGuias');
  xml.tag('ans:numeroLote', numeroLote);

  for (const guia of guias) {
    emitGuiaConsulta(xml, guia);
  }

  xml.close('ans:loteGuias');
  xml.close('ans:prestadorParaOperadora');

  // ---- Epilogo: hash ----
  xml.open('ans:epilogo');
  xml.tag('ans:hash', hash);
  xml.close('ans:epilogo');

  xml.close('ans:mensagemTISS');

  // Codifica para ISO-8859-1
  const encoded = encodeIso8859(xml.toString());

  return {
    xml: encoded.bytes,
    warnings: encoded.warnings,
  };
}

function emitCabecalho(xml: XmlBuilder, cab: LoteConsultaInput['cabecalho']): void {
  xml.open('ans:cabecalho');
  xml.tag('ans:versaoPadrao', cab.versaoPadrao);
  xml.tag('ans:registroANS', cab.registroANS);
  xml.tag('ans:dataGeracao', cab.dataGeracao);
  xml.tag('ans:horaGeracao', cab.horaGeracao);
  xml.tag('ans:sequencialTransacao', cab.sequencialTransacao);
  xml.close('ans:cabecalho');
}

function emitGuiaConsulta(xml: XmlBuilder, guia: GuiaConsultaInput): void {
  xml.open('ans:guiaConsulta');

  xml.tag('ans:numeroGuiaPrestador', guia.numeroGuiaPrestador);
  xml.optionalTag('ans:numeroGuiaOperadora', guia.numeroGuiaOperadora);
  xml.tag('ans:numeroCarteira', guia.numeroCarteira);
  xml.tag('ans:atendimentoRN', guia.atendimentoRN ? 'S' : 'N');

  // Dados do contratado
  xml.open('ans:dadosContratado');
  xml.optionalTag('ans:codigoPrestadorNaOperadora', guia.contratado.codigoPrestadorNaOperadora);
  xml.optionalTag('ans:cpfContratado', guia.contratado.cpfContratado);
  xml.optionalTag('ans:cnpjContratado', guia.contratado.cnpjContratado);
  xml.tag('ans:CNES', guia.contratado.cnes);
  xml.close('ans:dadosContratado');

  // Profissional executante
  xml.open('ans:profissionalExecutante');
  xml.tag('ans:conselhoProfissional', guia.profissionalExecutante.conselhoProfissional);
  xml.tag('ans:numeroConselho', guia.profissionalExecutante.numeroConselho);
  xml.tag('ans:ufConselho', guia.profissionalExecutante.ufConselho);
  xml.tag('ans:CBOS', guia.profissionalExecutante.cbos);
  xml.close('ans:profissionalExecutante');

  // Dados do atendimento
  xml.tag('ans:indicacaoAcidente', guia.indicacaoAcidente);
  xml.tag('ans:regimeAtendimento', guia.regimeAtendimento);
  xml.optionalTag('ans:saudeOcupacional', guia.saudeOcupacional);
  xml.optionalTag('ans:coberturaEspecial', guia.coberturaEspecial);
  xml.tag('ans:dataAtendimento', guia.dataAtendimento);
  xml.tag('ans:tipoConsulta', guia.tipoConsulta);

  // Procedimento
  xml.tag('ans:codigoTabela', guia.codigoTabela);
  xml.tag('ans:codigoProcedimento', guia.codigoProcedimento);
  xml.tag('ans:valorProcedimento', formatValorReais(guia.valorProcedimentoCentavos));
  xml.optionalTag('ans:observacao', guia.observacao);

  xml.close('ans:guiaConsulta');
}

function formatValorReais(centavos: number): string {
  const reais = Math.trunc(centavos / 100);
  const cents = centavos % 100;
  return `${reais}.${String(cents).padStart(2, '0')}`;
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && pnpm vitest run packages/tiss/src/serializer/serialize-lote-consulta.test.ts
```

Saida esperada: 15 testes passando, 0 falhas.

- [ ] Commitar:

```bash
git add packages/tiss/src/serializer/serialize-lote-consulta.ts packages/tiss/src/serializer/serialize-lote-consulta.test.ts
git commit -m "feat(tiss): add TISS consultation batch XML serializer (pure, ISO-8859-1)"
```

---