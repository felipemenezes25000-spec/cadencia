import { chromium, type Browser } from 'playwright';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

let navegador: Browser | null = null;

async function obterNavegador(): Promise<Browser> {
  if (navegador !== null && navegador.isConnected()) return navegador;
  navegador = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  return navegador;
}

export async function closePdfPool(): Promise<void> {
  if (navegador !== null) { await navegador.close(); navegador = null; }
}

export interface RenderOptions {
  readonly timeoutMs?: number;
}

export async function renderPdf(html: string, opts: RenderOptions = {}): Promise<Uint8Array> {
  const browser = await obterNavegador();
  const contexto = await browser.newContext({ javaScriptEnabled: false });
  try {
    const pagina = await contexto.newPage();
    await pagina.route('**/*', (rota) => {
      if (rota.request().url().startsWith('data:')) return rota.continue();
      return rota.abort();
    });
    await pagina.setContent(html, { waitUntil: 'load',
                                    timeout: opts.timeoutMs ?? 15_000 });
    return await pagina.pdf({
      format: 'A4', printBackground: true, preferCSSPageSize: true,
    });
  } finally {
    await contexto.close();
  }
}

export interface StampOptions {
  readonly prefixo?: string;
}

export async function stampPageNumbers(
  pdfBytes: Uint8Array, opts: StampOptions = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const fonte = await doc.embedFont(StandardFonts.Courier);
  const paginas = doc.getPages();
  const total = paginas.length;

  paginas.forEach((pagina, indice) => {
    const texto = `${opts.prefixo === undefined ? '' : `${opts.prefixo} · `}${indice + 1}/${total}`;
    const largura = fonte.widthOfTextAtSize(texto, 8);
    pagina.drawText(texto, {
      x: pagina.getWidth() - largura - 36,
      y: 22,
      size: 8, font: fonte, color: rgb(0.33, 0.33, 0.33),
    });
  });

  return doc.save();
}
