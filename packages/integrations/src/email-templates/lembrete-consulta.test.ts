import { describe, expect, it } from 'vitest';
import { lembreteConsultaEmail } from './lembrete-consulta';

const vars = {
  nomePaciente: 'Joao Santos',
  nomeProfissional: 'Dra. Ana Costa',
  data: '20/08/2026',
  hora: '14:30',
  nomeClinica: 'Clinica Vida Nova',
} as const;

describe('lembreteConsultaEmail', () => {
  it('subject contem o nome da clinica', () => {
    const r = lembreteConsultaEmail(vars);
    expect(r.subject).toContain('Clinica Vida Nova');
  });

  it('subject segue o formato esperado', () => {
    const r = lembreteConsultaEmail(vars);
    expect(r.subject).toBe('Lembrete de consulta — Clinica Vida Nova');
  });

  it('html contem o nome do paciente', () => {
    const r = lembreteConsultaEmail(vars);
    expect(r.html).toContain('Joao Santos');
  });

  it('html contem a data da consulta', () => {
    const r = lembreteConsultaEmail(vars);
    expect(r.html).toContain('20/08/2026');
  });

  it('html contem o horario', () => {
    const r = lembreteConsultaEmail(vars);
    expect(r.html).toContain('14:30');
  });

  it('html contem o nome do profissional', () => {
    const r = lembreteConsultaEmail(vars);
    expect(r.html).toContain('Dra. Ana Costa');
  });

  it('text contem o nome do paciente', () => {
    const r = lembreteConsultaEmail(vars);
    expect(r.text).toContain('Joao Santos');
  });

  it('text contem a data e hora', () => {
    const r = lembreteConsultaEmail(vars);
    expect(r.text).toContain('20/08/2026 as 14:30');
  });
});
