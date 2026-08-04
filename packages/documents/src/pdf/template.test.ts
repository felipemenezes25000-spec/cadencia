import { describe, expect, it } from 'vitest';
import { documentHtml } from './template';

const BASE = {
  titulo: 'ATESTADO MÉDICO',
  clinica: { nome: 'Clínica Vila Nova', cnpj: '12ABC34501DE35', cnes: '1234567',
             endereco: 'Rua A, 100 — São Paulo/SP' },
  profissional: { nome: 'Dr. Alceu Prado', conselho: 'CRM', numero: '123456', uf: 'SP' },
  paciente: { nome: 'Maria Souza Lima', nascimento: '14/03/1988', cpf: '111.444.777-35' },
  emitidoEm: '03/08/2026',
  corpo: '<p>Atesto para os devidos fins que a paciente esteve sob meus cuidados.</p>',
};

describe('template do documento', () => {
  it('repete CNPJ e CNES em TODA pagina, via @page margin box', () => {
    const html = documentHtml(BASE);
    expect(html).toContain('@page');
    expect(html).toContain('@top-center');
    expect(html).toContain('12ABC34501DE35');
    expect(html).toContain('1234567');
  });

  it('numera as paginas com contadores de Paged Media', () => {
    expect(documentHtml(BASE)).toContain('counter(page)');
    expect(documentHtml(BASE)).toContain('counter(pages)');
  });

  it('usa a familia serif — o PDF nao e a tela', () => {
    expect(documentHtml(BASE)).toContain('IBM Plex Serif');
  });

  it('escapa HTML vindo do payload — nome de paciente nao injeta marcacao', () => {
    const html = documentHtml({ ...BASE,
      paciente: { ...BASE.paciente, nome: '<script>alert(1)</script>' } });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('registra o conselho do profissional — documento sem CRM nao vale', () => {
    expect(documentHtml(BASE)).toContain('CRM 123456/SP');
  });
});
