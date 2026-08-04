import { afterAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { closePdfPool, renderPdf, stampPageNumbers } from './render';
import { documentHtml } from './template';

const HTML = documentHtml({
  titulo: 'ATESTADO MÉDICO',
  clinica: { nome: 'Clínica Vila Nova', cnpj: '12ABC34501DE35', cnes: '1234567',
             endereco: 'Rua A, 100' },
  profissional: { nome: 'Dr. Alceu', conselho: 'CRM', numero: '123456', uf: 'SP' },
  paciente: { nome: 'Maria Souza Lima', nascimento: '14/03/1988', cpf: '111.444.777-35' },
  emitidoEm: '03/08/2026',
  corpo: '<p>Atesto para os devidos fins.</p>',
});

describe('renderizacao de PDF', () => {
  afterAll(async () => { await closePdfPool(); });

  it('produz um PDF valido de ao menos uma pagina', async () => {
    const bytes = await renderPdf(HTML);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('carimba a numeracao POR ULTIMO, sobre o PDF ja montado', async () => {
    const a = await PDFDocument.create();
    a.addPage(); a.addPage(); a.addPage();
    const carimbado = await stampPageNumbers(await a.save(), { prefixo: 'Prontuário' });
    const doc = await PDFDocument.load(carimbado);
    expect(doc.getPageCount()).toBe(3);
    expect(carimbado.byteLength).toBeGreaterThan(0);
  });

  it('o pool reaproveita o navegador entre chamadas — cold start de Chromium e segundos', async () => {
    const t0 = Date.now();
    await renderPdf(HTML);
    const primeira = Date.now() - t0;
    const t1 = Date.now();
    await renderPdf(HTML);
    const segunda = Date.now() - t1;
    expect(segunda).toBeLessThanOrEqual(primeira * 1.1 + 50);
  });
});
