export interface Srgb { r: number; g: number; b: number }

export function oklchParaSrgb(l: number, c: number, hGraus: number): Srgb {
  const h = (hGraus * Math.PI) / 180;
  const a = c * Math.cos(h);
  const bb = c * Math.sin(h);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * bb;

  const L = l_ * l_ * l_;
  const M = m_ * m_ * m_;
  const S = s_ * s_ * s_;

  const rLin = +4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
  const gLin = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
  const bLin = -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S;

  const gama = (v: number): number => {
    const x = Math.max(0, Math.min(1, v));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  };

  return { r: gama(rLin), g: gama(gLin), b: gama(bLin) };
}

export function luminanciaRelativa(c: Srgb): number {
  const canal = (v: number): number =>
    v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  return 0.2126 * canal(c.r) + 0.7152 * canal(c.g) + 0.0722 * canal(c.b);
}

export function razaoDeContraste(l1: number, l2: number): number {
  const claro = Math.max(l1, l2);
  const escuro = Math.min(l1, l2);
  return (claro + 0.05) / (escuro + 0.05);
}

export function lerToken(css: string, nome: string): string | null {
  const m = new RegExp(`${nome}\\s*:\\s*([^;]+);`).exec(css);
  return m?.[1]?.trim() ?? null;
}
