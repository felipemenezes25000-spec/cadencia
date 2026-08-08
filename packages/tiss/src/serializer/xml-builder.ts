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
