import { describe, expect, it } from 'vitest';
import { conviteEquipeEmail } from './convite-equipe';

const vars = {
  nomeConvidado: 'Maria Silva',
  nomeClinica: 'Clinica Saude Plena',
  urlConvite: 'https://app.cadencia.com.br/convite/abc123',
} as const;

describe('conviteEquipeEmail', () => {
  it('subject contem o nome da clinica', () => {
    const r = conviteEquipeEmail(vars);
    expect(r.subject).toBe('Convite para a equipe da Clinica Saude Plena');
  });

  it('html contem a URL do convite', () => {
    const r = conviteEquipeEmail(vars);
    expect(r.html).toContain(vars.urlConvite);
  });

  it('html contem o nome do convidado', () => {
    const r = conviteEquipeEmail(vars);
    expect(r.html).toContain('Maria Silva');
  });

  it('html contem o nome da clinica', () => {
    const r = conviteEquipeEmail(vars);
    expect(r.html).toContain('Clinica Saude Plena');
  });

  it('html contem a cor da marca no botao CTA', () => {
    const r = conviteEquipeEmail(vars);
    expect(r.html).toContain('#087783');
  });

  it('text contem a URL do convite', () => {
    const r = conviteEquipeEmail(vars);
    expect(r.text).toContain(vars.urlConvite);
  });

  it('text contem o nome do convidado', () => {
    const r = conviteEquipeEmail(vars);
    expect(r.text).toContain('Maria Silva');
  });
});
