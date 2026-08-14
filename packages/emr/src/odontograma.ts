/**
 * Odontograma — o formato do `value_json` do campo de kind `odontograma`.
 *
 * Notação FDI (ISO 3950), que é a usada no Brasil e a que o TUSS e as
 * operadoras esperam na guia. Dois dígitos: o primeiro é o quadrante, o
 * segundo é a posição a partir da linha média.
 *
 *   Permanente   18-11 | 21-28        Decídua   55-51 | 61-65
 *                48-41 | 31-38                  85-81 | 71-75
 *
 * Por que o dente inteiro E a face: cárie e restauração são achados de FACE
 * (oclusal cariada, mesial restaurada), enquanto ausência, implante e prótese
 * são do dente todo. Modelar só um dos dois obrigaria a mentir num dos casos.
 *
 * O odontograma NÃO promove para clin.observation (ver field-kinds.ts): não é
 * eixo de relatório que entregamos. Ele é o retrato da boca naquela versão do
 * prontuário, e a versão anterior continua acessível pelo histórico.
 */

/* ── Dentes ───────────────────────────────────────────────────────────── */

export const DENTES_PERMANENTES = [
  18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28,
  48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38,
] as const;

export const DENTES_DECIDUOS = [
  55, 54, 53, 52, 51, 61, 62, 63, 64, 65,
  85, 84, 83, 82, 81, 71, 72, 73, 74, 75,
] as const;

export type DentePermanente = (typeof DENTES_PERMANENTES)[number];
export type DenteDeciduo = (typeof DENTES_DECIDUOS)[number];
export type Dente = DentePermanente | DenteDeciduo;

const TODOS = new Set<number>([...DENTES_PERMANENTES, ...DENTES_DECIDUOS]);

export function ehDenteValido(n: number): n is Dente {
  return TODOS.has(n);
}

/** Anteriores (incisivos e caninos) têm face incisal; posteriores, oclusal. */
export function ehAnterior(dente: Dente): boolean {
  const posicao = dente % 10;
  return posicao >= 1 && posicao <= 3;
}

/* ── Faces ────────────────────────────────────────────────────────────── */

export const FACES = ['vestibular', 'lingual', 'mesial', 'distal', 'oclusal'] as const;
export type Face = (typeof FACES)[number];

export const ROTULO_DA_FACE: Readonly<Record<Face, string>> = {
  vestibular: 'Vestibular',
  lingual: 'Lingual/palatina',
  mesial: 'Mesial',
  distal: 'Distal',
  oclusal: 'Oclusal/incisal',
};

/* ── Condições ────────────────────────────────────────────────────────── */

/** Do dente inteiro. */
export const CONDICOES_DO_DENTE = [
  'higido', 'ausente', 'extraido', 'extracao_indicada',
  'implante', 'protese', 'raiz_residual', 'nao_erupcionado',
] as const;
export type CondicaoDoDente = (typeof CONDICOES_DO_DENTE)[number];

/** De uma face. */
export const CONDICOES_DA_FACE = [
  'higida', 'carie', 'restauracao', 'selante', 'fratura',
] as const;
export type CondicaoDaFace = (typeof CONDICOES_DA_FACE)[number];

export const ROTULO_DA_CONDICAO_DO_DENTE: Readonly<Record<CondicaoDoDente, string>> = {
  higido: 'Hígido',
  ausente: 'Ausente',
  extraido: 'Extraído',
  extracao_indicada: 'Extração indicada',
  implante: 'Implante',
  protese: 'Prótese',
  raiz_residual: 'Raiz residual',
  nao_erupcionado: 'Não erupcionado',
};

export const ROTULO_DA_CONDICAO_DA_FACE: Readonly<Record<CondicaoDaFace, string>> = {
  higida: 'Hígida',
  carie: 'Cárie',
  restauracao: 'Restauração',
  selante: 'Selante',
  fratura: 'Fratura',
};

/* ── Documento ────────────────────────────────────────────────────────── */

export type Denticao = 'permanente' | 'decidua' | 'mista';

export interface EstadoDoDente {
  readonly condicao?: CondicaoDoDente;
  readonly faces?: Readonly<Partial<Record<Face, CondicaoDaFace>>>;
  readonly nota?: string;
}

export interface Odontograma {
  readonly denticao: Denticao;
  /** Chave = número FDI em texto. Dente ausente do mapa = hígido, sem marcação. */
  readonly dentes: Readonly<Record<string, EstadoDoDente>>;
}

export const ODONTOGRAMA_VAZIO: Odontograma = { denticao: 'permanente', dentes: {} };

/** Quais dentes a arcada mostra, na ordem de exibição. */
export function dentesDaDenticao(d: Denticao): readonly Dente[] {
  if (d === 'permanente') return DENTES_PERMANENTES;
  if (d === 'decidua') return DENTES_DECIDUOS;
  return [...DENTES_PERMANENTES, ...DENTES_DECIDUOS];
}

/* ── Serialização ─────────────────────────────────────────────────────── */

/**
 * Lê o `value_json`. NUNCA lança: prontuário antigo, campo em branco ou JSON
 * corrompido devolvem odontograma vazio em vez de derrubar a ficha inteira do
 * paciente. Perder a marcação é ruim; perder a tela é pior.
 */
export function lerOdontograma(bruto: string | null | undefined): Odontograma {
  if (bruto === null || bruto === undefined || bruto.trim() === '') return ODONTOGRAMA_VAZIO;
  let cru: unknown;
  try {
    cru = JSON.parse(bruto);
  } catch {
    return ODONTOGRAMA_VAZIO;
  }
  if (typeof cru !== 'object' || cru === null) return ODONTOGRAMA_VAZIO;

  const obj = cru as Record<string, unknown>;
  const denticao: Denticao =
    obj['denticao'] === 'decidua' || obj['denticao'] === 'mista' ? obj['denticao'] : 'permanente';

  const dentes: Record<string, EstadoDoDente> = {};
  const brutoDentes = obj['dentes'];
  if (typeof brutoDentes === 'object' && brutoDentes !== null) {
    for (const [chave, valor] of Object.entries(brutoDentes as Record<string, unknown>)) {
      const numero = Number(chave);
      if (!Number.isInteger(numero) || !ehDenteValido(numero)) continue;
      if (typeof valor !== 'object' || valor === null) continue;
      const estado = sanearEstado(valor as Record<string, unknown>);
      if (estado !== null) dentes[chave] = estado;
    }
  }
  return { denticao, dentes };
}

function sanearEstado(v: Record<string, unknown>): EstadoDoDente | null {
  const estado: {
    condicao?: CondicaoDoDente;
    faces?: Partial<Record<Face, CondicaoDaFace>>;
    nota?: string;
  } = {};

  if (typeof v['condicao'] === 'string'
      && (CONDICOES_DO_DENTE as readonly string[]).includes(v['condicao'])) {
    estado.condicao = v['condicao'] as CondicaoDoDente;
  }

  const faces = v['faces'];
  if (typeof faces === 'object' && faces !== null) {
    const limpas: Partial<Record<Face, CondicaoDaFace>> = {};
    for (const [face, cond] of Object.entries(faces as Record<string, unknown>)) {
      if (!(FACES as readonly string[]).includes(face)) continue;
      if (typeof cond !== 'string') continue;
      if (!(CONDICOES_DA_FACE as readonly string[]).includes(cond)) continue;
      limpas[face as Face] = cond as CondicaoDaFace;
    }
    if (Object.keys(limpas).length > 0) estado.faces = limpas;
  }

  if (typeof v['nota'] === 'string' && v['nota'].trim() !== '') {
    estado.nota = v['nota'].slice(0, 500);
  }

  return Object.keys(estado).length === 0 ? null : estado;
}

/** Grava o `value_json`. Dente sem marcação nenhuma não entra — o JSON guarda o
 *  que foi afirmado, não a arcada inteira repetida a cada versão. */
export function escreverOdontograma(o: Odontograma): string {
  const dentes: Record<string, EstadoDoDente> = {};
  for (const [chave, estado] of Object.entries(o.dentes)) {
    const temFace = estado.faces !== undefined && Object.keys(estado.faces).length > 0;
    if (estado.condicao !== undefined || temFace || estado.nota !== undefined) {
      dentes[chave] = estado;
    }
  }
  return JSON.stringify({ denticao: o.denticao, dentes });
}

/** Quantos dentes têm alguma marcação — usado no resumo da ficha. */
export function contarMarcados(o: Odontograma): number {
  return Object.keys(o.dentes).length;
}
