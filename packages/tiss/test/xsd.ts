// packages/tiss/test/xsd.ts
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  XmlDocument, XsdValidator, xmlRegisterInputProvider,
} from 'libxml2-wasm';

/**
 * Validação do XML gerado contra o XSD OFICIAL da ANS.
 *
 * Até agora o repositório tinha um `tissV4_01_00.xsd` de 3 KB escrito a mão, com
 * `xs:string` em todo campo — um schema que aceitaria praticamente qualquer
 * coisa. E o teste que o usava dependia do binário `xmllint`, ausente na máquina
 * e no CI, então rodava sempre PULADO. Duas camadas de validação aparente e zero
 * de validação real.
 *
 * Aqui o schema é o publicado pela ANS (`schemas/4.03.00/`, 240 KB entre tipos
 * simples e complexos) e o validador é o próprio libxml2 compilado para WASM —
 * sem binário externo, então o teste EXECUTA, no Windows e no CI.
 */

const DIR_SCHEMAS = resolve(import.meta.dirname, '../schemas/4.03.00');
const RAIZ = resolve(DIR_SCHEMAS, 'tissV4_03_00.xsd');

/**
 * O XSD raiz faz `include` de outros quatro arquivos por caminho relativo.
 * Dentro do WASM não existe o sistema de arquivos do host, então a resolução
 * passa por um provedor que lê do disco de verdade. Sem isto, o libxml2 carrega
 * só o arquivo raiz e valida contra um schema mutilado — que aceitaria demais,
 * repetindo em silêncio o defeito do XSD de amostra.
 */
let provedorRegistrado = false;

function registrarProvedor(): void {
  if (provedorRegistrado) return;
  provedorRegistrado = true;

  const abertos = new Map<number, { buf: Buffer; pos: number }>();
  let proximo = 1;

  xmlRegisterInputProvider({
    match: (nome: string) => existsSync(resolve(DIR_SCHEMAS, basename(nome))),
    open: (nome: string) => {
      const fd = proximo;
      proximo += 1;
      abertos.set(fd, { buf: readFileSync(resolve(DIR_SCHEMAS, basename(nome))), pos: 0 });
      return fd;
    },
    read: (fd: number, destino: Uint8Array) => {
      const s = abertos.get(fd);
      if (s === undefined) return -1;
      const n = Math.min(destino.byteLength, s.buf.byteLength - s.pos);
      if (n <= 0) return 0;
      destino.set(s.buf.subarray(s.pos, s.pos + n));
      s.pos += n;
      return n;
    },
    close: (fd: number) => abertos.delete(fd),
  });
}

let validador: XsdValidator | null = null;

function obterValidador(): XsdValidator {
  if (validador !== null) return validador;
  registrarProvedor();
  // Carregar os 240 KB de schema custa ~1s; uma vez por processo de teste.
  const doc = XmlDocument.fromBuffer(readFileSync(RAIZ), { url: RAIZ });
  validador = XsdValidator.fromDoc(doc);
  return validador;
}

export interface ResultadoXsd {
  readonly valido: boolean;
  /** Uma linha por violação, na ordem em que o libxml2 as encontrou. */
  readonly erros: readonly string[];
}

/**
 * Valida bytes de XML TISS contra o XSD 4.03.00 da ANS.
 *
 * Recebe `Uint8Array` e não `string` de propósito: o TISS exige ISO-8859-1, e
 * converter para string UTF-16 antes de validar esconderia justamente os erros
 * de encoding que a operadora rejeitaria.
 */
export function validarContraXsdTiss(xml: Uint8Array): ResultadoXsd {
  const doc = XmlDocument.fromBuffer(xml);
  try {
    obterValidador().validate(doc);
    return { valido: true, erros: [] };
  } catch (e) {
    const texto = e instanceof Error ? e.message : String(e);
    return {
      valido: false,
      erros: texto.split('\n').map((l) => l.trim()).filter((l) => l !== ''),
    };
  } finally {
    doc.dispose();
  }
}
