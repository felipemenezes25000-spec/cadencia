### Task 43: xml-builder tipado — montagem segura de XML com escape de entidades

**Arquivos**

- Criar `packages/tiss/src/serializer/xml-builder.ts`
- Teste `packages/tiss/src/serializer/xml-builder.test.ts`

**Passos**

- [ ] Criar o teste `packages/tiss/src/serializer/xml-builder.test.ts` (TDD):

```ts
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
    builder.tag('nome', 'Jo\u00E3o da Silva');
    builder.close('raiz');
    const xml = builder.toString();
    expect(xml).toContain('<nome>Jo\u00E3o da Silva</nome>');
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
```

- [ ] Rodar e confirmar falha de import:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && pnpm vitest run packages/tiss/src/serializer/xml-builder.test.ts
```

Saida esperada: falha — `Cannot find module './xml-builder'`.

- [ ] Criar a implementacao `packages/tiss/src/serializer/xml-builder.ts`:

```ts
/**
 * Builder tipado para XML TISS.
 *
 * NAO usa concatenacao de string direta para conteudo — todo texto passa
 * por escape de entidades XML. O builder rastreia a pilha de tags abertas
 * e rejeita fechamento fora de ordem, impossibilitando XML malformado.
 */

const ENTITY_MAP: ReadonlyMap<number, string> = new Map([
  [0x26, '&amp;'],   // & — DEVE ser primeiro para nao re-escapar
  [0x3C, '&lt;'],    // <
  [0x3E, '&gt;'],    // >
  [0x22, '&quot;'],  // "
  [0x27, '&apos;'],  // '
]);

function escapeXml(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const entity = ENTITY_MAP.get(code);
    result += entity ?? text[i];
  }
  return result;
}

export class XmlBuilder {
  private readonly parts: string[] = ['<?xml version="1.0" encoding="ISO-8859-1"?>'];
  private readonly stack: string[] = [];

  /** Abre uma tag sem atributos. */
  open(tagName: string): void {
    this.parts.push(`<${tagName}>`);
    this.stack.push(tagName);
  }

  /** Abre uma tag com atributos na ordem fornecida. */
  openWithAttrs(tagName: string, attrs: Record<string, string>): void {
    const attrStr = Object.entries(attrs)
      .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
      .join('');
    this.parts.push(`<${tagName}${attrStr}>`);
    this.stack.push(tagName);
  }

  /** Fecha a tag no topo da pilha. Erro se o nome nao bater. */
  close(tagName: string): void {
    const top = this.stack.pop();
    if (top === undefined) {
      throw new Error(`Tentativa de fechar tag "${tagName}" mas nenhuma tag esta aberta`);
    }
    if (top !== tagName) {
      this.stack.push(top); // restaura para nao corromper o estado
      throw new Error(`Tentativa de fechar tag "${tagName}" mas a tag aberta e "${top}"`);
    }
    this.parts.push(`</${tagName}>`);
  }

  /** Emite tag folha com conteudo texto (escape automatico). */
  tag(tagName: string, value: string): void {
    this.parts.push(`<${tagName}>${escapeXml(value)}</${tagName}>`);
  }

  /** Emite tag folha apenas se value !== undefined. */
  optionalTag(tagName: string, value: string | undefined): void {
    if (value === undefined) return;
    this.tag(tagName, value);
  }

  /** Retorna o XML completo como string UTF-16 (sera codificado para ISO-8859-1 depois). */
  toString(): string {
    return this.parts.join('');
  }
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && pnpm vitest run packages/tiss/src/serializer/xml-builder.test.ts
```

Saida esperada: 11 testes passando, 0 falhas.

- [ ] Commitar:

```bash
git add packages/tiss/src/serializer/xml-builder.ts packages/tiss/src/serializer/xml-builder.test.ts
git commit -m "feat(tiss): add typed XML builder with entity escaping and tag stack validation"
```

---