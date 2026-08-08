import { describe, expect, it } from 'vitest';
import { XmlBuilder } from './xml-builder';

describe('XmlBuilder', () => {
  it('gera declaracao XML com encoding ISO-8859-1', () => {
    const builder = new XmlBuilder();
    const xml = builder.toString();
    expect(xml).toBe('<?xml version="1.0" encoding="ISO-8859-1"?>');
  });

  it('abre e fecha tag simples', () => {
    const builder = new XmlBuilder();
    builder.open('ans:teste');
    builder.close('ans:teste');
    const xml = builder.toString();
    expect(xml).toBe(
      '<?xml version="1.0" encoding="ISO-8859-1"?>' +
      '<ans:teste></ans:teste>',
    );
  });

  it('escreve tag com conteudo texto', () => {
    const builder = new XmlBuilder();
    builder.open('raiz');
    builder.tag('nome', 'João da Silva');
    builder.close('raiz');
    const xml = builder.toString();
    expect(xml).toContain('<nome>João da Silva</nome>');
  });

  it('escapa entidades XML no conteudo de texto', () => {
    const builder = new XmlBuilder();
    builder.open('raiz');
    builder.tag('obs', 'a < b & c > d "e" \'f\'');
    builder.close('raiz');
    const xml = builder.toString();
    expect(xml).toContain(
      '<obs>a &lt; b &amp; c &gt; d &quot;e&quot; &apos;f&apos;</obs>',
    );
  });

  it('escapa entidades XML em valores de atributo', () => {
    const builder = new XmlBuilder();
    builder.openWithAttrs('tag', { id: 'a&b<c' });
    builder.close('tag');
    const xml = builder.toString();
    expect(xml).toContain('<tag id="a&amp;b&lt;c"></tag>');
  });

  it('gera atributos na ordem fornecida', () => {
    const builder = new XmlBuilder();
    builder.openWithAttrs('tag', { xmlns: 'http://example.com', version: '1.0' });
    builder.close('tag');
    const xml = builder.toString();
    expect(xml).toContain('<tag xmlns="http://example.com" version="1.0"></tag>');
  });

  it('suporta tags aninhadas em profundidade', () => {
    const builder = new XmlBuilder();
    builder.open('a');
    builder.open('b');
    builder.open('c');
    builder.tag('d', 'valor');
    builder.close('c');
    builder.close('b');
    builder.close('a');
    const xml = builder.toString();
    expect(xml).toContain('<a><b><c><d>valor</d></c></b></a>');
  });

  it('rejeita close de tag que nao foi aberta ou esta fora de ordem', () => {
    const builder = new XmlBuilder();
    builder.open('a');
    expect(() => builder.close('b')).toThrow(
      'Tentativa de fechar tag "b" mas a tag aberta e "a"',
    );
  });

  it('rejeita close quando nenhuma tag esta aberta', () => {
    const builder = new XmlBuilder();
    expect(() => builder.close('a')).toThrow(
      'Tentativa de fechar tag "a" mas nenhuma tag esta aberta',
    );
  });

  it('nao emite tag quando valor e undefined (campo opcional omitido)', () => {
    const builder = new XmlBuilder();
    builder.open('raiz');
    builder.optionalTag('campo', undefined);
    builder.tag('obrigatorio', 'sim');
    builder.close('raiz');
    const xml = builder.toString();
    expect(xml).not.toContain('campo');
    expect(xml).toContain('<obrigatorio>sim</obrigatorio>');
  });

  it('emite tag quando valor e string vazia (campo presente mas vazio)', () => {
    const builder = new XmlBuilder();
    builder.open('raiz');
    builder.optionalTag('campo', '');
    builder.close('raiz');
    const xml = builder.toString();
    expect(xml).toContain('<campo></campo>');
  });
});
