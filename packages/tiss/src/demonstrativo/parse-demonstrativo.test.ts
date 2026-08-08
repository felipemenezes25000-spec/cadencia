// packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts
import { describe, expect, it } from 'vitest';
import { decodeIso8859, parseDemonstrativoXml } from './parse-demonstrativo';
import { encodeIso8859 } from '../serializer/encode-iso8859';

describe('decodeIso8859', () => {
  it('decodifica bytes ASCII em string identica', () => {
    const bytes = new Uint8Array([0x48, 0x65, 0x6C, 0x6C, 0x6F]);
    expect(decodeIso8859(bytes)).toBe('Hello');
  });

  it('decodifica bytes acentuados ISO-8859-1 para caracteres corretos', () => {
    // e agudo = 0xE9, c cedilha = 0xE7, a til = 0xE3
    const bytes = new Uint8Array([0xE9, 0xE7, 0xE3]);
    expect(decodeIso8859(bytes)).toBe('éçã');
  });

  it('decodifica Uint8Array vazio em string vazia', () => {
    expect(decodeIso8859(new Uint8Array([]))).toBe('');
  });

  it('preserva roundtrip com encodeIso8859 para texto portugues', () => {
    const texto = 'Procedimento não autorizado pela clínica';
    const encoded = encodeIso8859(texto);
    expect(encoded.warnings).toHaveLength(0);
    expect(decodeIso8859(encoded.bytes)).toBe(texto);
  });
});

/** Fixture: demonstrativo de analise com 3 guias de consulta. */
const SAMPLE_ANALISE = [
  '<?xml version="1.0" encoding="ISO-8859-1"?>',
  '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
  '<ans:cabecalho>',
  '<ans:versaoPadrao>4.01.00</ans:versaoPadrao>',
  '<ans:registroANS>999999</ans:registroANS>',
  '<ans:dataGeracao>2026-08-05</ans:dataGeracao>',
  '<ans:horaGeracao>10:30:00</ans:horaGeracao>',
  '<ans:sequencialTransacao>999</ans:sequencialTransacao>',
  '</ans:cabecalho>',
  '<ans:operadoraParaPrestador>',
  '<ans:demonstrativoAnaliseConta>',
  '<ans:cabecalhoDemonstrativo>',
  '<ans:registroANS>326305</ans:registroANS>',
  '<ans:numeroDemonstrativo>DEMO-2026-001</ans:numeroDemonstrativo>',
  '</ans:cabecalhoDemonstrativo>',
  '<ans:dadosProtocolo>',
  '<ans:numeroProtocolo>PROT-001</ans:numeroProtocolo>',
  '</ans:dadosProtocolo>',
  '<ans:dataProcessamento>2026-08-05</ans:dataProcessamento>',
  '<ans:relacaoGuias>',
  // --- Guia 1: paga integralmente, sem glosa ---
  '<ans:guiaCabecalho>',
  '<ans:numeroGuiaPrestador>CY-001</ans:numeroGuiaPrestador>',
  '<ans:valorInformadoGuia>100.00</ans:valorInformadoGuia>',
  '<ans:valorProcessadoGuia>100.00</ans:valorProcessadoGuia>',
  '<ans:valorLiberadoGuia>100.00</ans:valorLiberadoGuia>',
  '<ans:valorGlosaGuia>0.00</ans:valorGlosaGuia>',
  '</ans:guiaCabecalho>',
  // --- Guia 2: glosa parcial (R$ 50 de R$ 200) ---
  '<ans:guiaCabecalho>',
  '<ans:numeroGuiaPrestador>CY-002</ans:numeroGuiaPrestador>',
  '<ans:numeroGuiaOperadora>OP-5678</ans:numeroGuiaOperadora>',
  '<ans:valorInformadoGuia>200.00</ans:valorInformadoGuia>',
  '<ans:valorProcessadoGuia>150.00</ans:valorProcessadoGuia>',
  '<ans:valorLiberadoGuia>150.00</ans:valorLiberadoGuia>',
  '<ans:valorGlosaGuia>50.00</ans:valorGlosaGuia>',
  '<ans:glosas>',
  '<ans:glosa>',
  '<ans:codigoGlosa>A010</ans:codigoGlosa>',
  '<ans:descricaoGlosa>Valor acima do autorizado</ans:descricaoGlosa>',
  '</ans:glosa>',
  '</ans:glosas>',
  '</ans:guiaCabecalho>',
  // --- Guia 3: glosa total (R$ 300 de R$ 300, 2 codigos de glosa) ---
  '<ans:guiaCabecalho>',
  '<ans:numeroGuiaPrestador>CY-003</ans:numeroGuiaPrestador>',
  '<ans:valorInformadoGuia>300.00</ans:valorInformadoGuia>',
  '<ans:valorProcessadoGuia>0.00</ans:valorProcessadoGuia>',
  '<ans:valorLiberadoGuia>0.00</ans:valorLiberadoGuia>',
  '<ans:valorGlosaGuia>300.00</ans:valorGlosaGuia>',
  '<ans:glosas>',
  '<ans:glosa>',
  '<ans:codigoGlosa>B015</ans:codigoGlosa>',
  '<ans:descricaoGlosa>Procedimento nao coberto pelo plano</ans:descricaoGlosa>',
  '</ans:glosa>',
  '<ans:glosa>',
  '<ans:codigoGlosa>C020</ans:codigoGlosa>',
  '<ans:descricaoGlosa>Guia vencida</ans:descricaoGlosa>',
  '</ans:glosa>',
  '</ans:glosas>',
  '</ans:guiaCabecalho>',
  '</ans:relacaoGuias>',
  '</ans:demonstrativoAnaliseConta>',
  '</ans:operadoraParaPrestador>',
  '<ans:epilogo><ans:hash>abc123</ans:hash></ans:epilogo>',
  '</ans:mensagemTISS>',
].join('\n');

describe('parseDemonstrativoXml', () => {
  it('detecta tipo pagamento a partir da tag demonstrativoPagamento', () => {
    const xmlPagamento = [
      '<?xml version="1.0" encoding="ISO-8859-1"?>',
      '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
      '<ans:cabecalho>',
      '<ans:versaoPadrao>4.01.00</ans:versaoPadrao>',
      '<ans:registroANS>999999</ans:registroANS>',
      '<ans:dataGeracao>2026-08-10</ans:dataGeracao>',
      '<ans:horaGeracao>14:00:00</ans:horaGeracao>',
      '<ans:sequencialTransacao>1000</ans:sequencialTransacao>',
      '</ans:cabecalho>',
      '<ans:operadoraParaPrestador>',
      '<ans:demonstrativoPagamento>',
      '<ans:cabecalhoDemonstrativo>',
      '<ans:registroANS>326305</ans:registroANS>',
      '<ans:numeroDemonstrativo>PAG-2026-001</ans:numeroDemonstrativo>',
      '</ans:cabecalhoDemonstrativo>',
      '<ans:dadosProtocolo>',
      '<ans:numeroProtocolo>PROT-PAG-001</ans:numeroProtocolo>',
      '</ans:dadosProtocolo>',
      '<ans:dataProcessamento>2026-08-10</ans:dataProcessamento>',
      '<ans:relacaoGuias>',
      '<ans:guiaCabecalho>',
      '<ans:numeroGuiaPrestador>PG-001</ans:numeroGuiaPrestador>',
      '<ans:valorInformadoGuia>500.00</ans:valorInformadoGuia>',
      '<ans:valorProcessadoGuia>500.00</ans:valorProcessadoGuia>',
      '<ans:valorLiberadoGuia>500.00</ans:valorLiberadoGuia>',
      '<ans:valorGlosaGuia>0.00</ans:valorGlosaGuia>',
      '</ans:guiaCabecalho>',
      '</ans:relacaoGuias>',
      '</ans:demonstrativoPagamento>',
      '</ans:operadoraParaPrestador>',
      '<ans:epilogo><ans:hash>def456</ans:hash></ans:epilogo>',
      '</ans:mensagemTISS>',
    ].join('\n');

    const encoded = encodeIso8859(xmlPagamento);
    const result = parseDemonstrativoXml(encoded.bytes);

    expect(result.tipo).toBe('pagamento');
    expect(result.cabecalho.numeroDemonstrativo).toBe('PAG-2026-001');
    expect(result.cabecalho.numeroProtocolo).toBe('PROT-PAG-001');
    expect(result.itens).toHaveLength(1);
    expect(result.itens[0]!.numeroGuiaPrestador).toBe('PG-001');
    expect(result.itens[0]!.valorInformadoCents).toBe(50000);
    expect(result.itens[0]!.valorGlosaCents).toBe(0);
  });

  it('decodifica acentos ISO-8859-1 na descricao de glosa', () => {
    const xmlComAcentos = [
      '<?xml version="1.0" encoding="ISO-8859-1"?>',
      '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
      '<ans:cabecalho><ans:versaoPadrao>4.01.00</ans:versaoPadrao>',
      '<ans:registroANS>999999</ans:registroANS>',
      '<ans:dataGeracao>2026-08-05</ans:dataGeracao>',
      '<ans:horaGeracao>10:00:00</ans:horaGeracao>',
      '<ans:sequencialTransacao>1</ans:sequencialTransacao></ans:cabecalho>',
      '<ans:operadoraParaPrestador>',
      '<ans:demonstrativoAnaliseConta>',
      '<ans:cabecalhoDemonstrativo>',
      '<ans:registroANS>326305</ans:registroANS>',
      '<ans:numeroDemonstrativo>AC-ACENTO</ans:numeroDemonstrativo>',
      '</ans:cabecalhoDemonstrativo>',
      '<ans:dadosProtocolo><ans:numeroProtocolo>P-AC</ans:numeroProtocolo></ans:dadosProtocolo>',
      '<ans:dataProcessamento>2026-08-05</ans:dataProcessamento>',
      '<ans:relacaoGuias>',
      '<ans:guiaCabecalho>',
      '<ans:numeroGuiaPrestador>AC-001</ans:numeroGuiaPrestador>',
      '<ans:valorInformadoGuia>100.00</ans:valorInformadoGuia>',
      '<ans:valorProcessadoGuia>50.00</ans:valorProcessadoGuia>',
      '<ans:valorLiberadoGuia>50.00</ans:valorLiberadoGuia>',
      '<ans:valorGlosaGuia>50.00</ans:valorGlosaGuia>',
      '<ans:glosas><ans:glosa>',
      '<ans:codigoGlosa>X001</ans:codigoGlosa>',
      // 'nao' com til: n + a-til + o = caracteres ISO-8859-1 validos
      '<ans:descricaoGlosa>Procedimento não autorizado pela clínica</ans:descricaoGlosa>',
      '</ans:glosa></ans:glosas>',
      '</ans:guiaCabecalho>',
      '</ans:relacaoGuias>',
      '</ans:demonstrativoAnaliseConta>',
      '</ans:operadoraParaPrestador>',
      '<ans:epilogo><ans:hash>xyz</ans:hash></ans:epilogo>',
      '</ans:mensagemTISS>',
    ].join('\n');

    const encoded = encodeIso8859(xmlComAcentos);
    expect(encoded.warnings).toHaveLength(0);

    const result = parseDemonstrativoXml(encoded.bytes);

    // Os acentos devem ser preservados apos decode ISO-8859-1
    expect(result.itens[0]!.glosas[0]!.descricaoGlosa).toBe(
      'Procedimento não autorizado pela clínica',
    );
  });

  it('extrai cabecalho, 3 itens e glosas de demonstrativo de analise', () => {
    const encoded = encodeIso8859(SAMPLE_ANALISE);
    const result = parseDemonstrativoXml(encoded.bytes);

    // Tipo detectado a partir da tag demonstrativoAnaliseConta
    expect(result.tipo).toBe('analise');

    // Cabecalho extraido do bloco cabecalhoDemonstrativo (NAO do cabecalho da mensagem)
    expect(result.cabecalho.registroANS).toBe('326305');
    expect(result.cabecalho.numeroDemonstrativo).toBe('DEMO-2026-001');
    expect(result.cabecalho.dataProcessamento).toBe('2026-08-05');
    expect(result.cabecalho.numeroProtocolo).toBe('PROT-001');

    expect(result.itens).toHaveLength(3);

    // --- Guia 1: paga integralmente ---
    const g1 = result.itens[0]!;
    expect(g1.numeroGuiaPrestador).toBe('CY-001');
    expect(g1.numeroGuiaOperadora).toBeUndefined();
    expect(g1.valorInformadoCents).toBe(10000);
    expect(g1.valorProcessadoCents).toBe(10000);
    expect(g1.valorLiberadoCents).toBe(10000);
    expect(g1.valorGlosaCents).toBe(0);
    expect(g1.glosas).toHaveLength(0);

    // --- Guia 2: glosa parcial ---
    const g2 = result.itens[1]!;
    expect(g2.numeroGuiaPrestador).toBe('CY-002');
    expect(g2.numeroGuiaOperadora).toBe('OP-5678');
    expect(g2.valorInformadoCents).toBe(20000);
    expect(g2.valorProcessadoCents).toBe(15000);
    expect(g2.valorLiberadoCents).toBe(15000);
    expect(g2.valorGlosaCents).toBe(5000);
    expect(g2.glosas).toHaveLength(1);
    expect(g2.glosas[0]!.codigoGlosa).toBe('A010');
    expect(g2.glosas[0]!.descricaoGlosa).toBe('Valor acima do autorizado');

    // --- Guia 3: glosa total ---
    const g3 = result.itens[2]!;
    expect(g3.numeroGuiaPrestador).toBe('CY-003');
    expect(g3.valorInformadoCents).toBe(30000);
    expect(g3.valorProcessadoCents).toBe(0);
    expect(g3.valorLiberadoCents).toBe(0);
    expect(g3.valorGlosaCents).toBe(30000);
    expect(g3.glosas).toHaveLength(2);
    expect(g3.glosas[0]!.codigoGlosa).toBe('B015');
    expect(g3.glosas[0]!.descricaoGlosa).toBe('Procedimento nao coberto pelo plano');
    expect(g3.glosas[1]!.codigoGlosa).toBe('C020');
    expect(g3.glosas[1]!.descricaoGlosa).toBe('Guia vencida');
  });
});
