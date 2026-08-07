import { describe, expect, it } from 'vitest';
import { exportReport } from './export';

const LINHAS = [
  { professional_name: 'Dra. Ana', patient_name: 'Carlos', occurred_date: '2026-07-15', status: 'realizado' },
  { professional_name: 'Dr. Bruno', patient_name: 'Maria', occurred_date: '2026-07-16', status: 'realizado' },
];

const COLUNAS = ['professional_name', 'patient_name', 'occurred_date', 'status'];

const CABECALHOS: Record<string, string> = {
  professional_name: 'Profissional',
  patient_name: 'Paciente',
  occurred_date: 'Data',
  status: 'Status',
};

describe('exportReport CSV', () => {
  it('gera CSV com cabecalho e linhas separadas por ponto e virgula', () => {
    const buf = exportReport(LINHAS, COLUNAS, CABECALHOS, 'csv');
    const texto = buf.toString('utf-8').replace(/^﻿/, '');
    const linhas = texto.split('\n').filter((l) => l.length > 0);
    expect(linhas[0]).toBe('Profissional;Paciente;Data;Status');
    expect(linhas[1]).toBe('Dra. Ana;Carlos;2026-07-15;realizado');
    expect(linhas[2]).toBe('Dr. Bruno;Maria;2026-07-16;realizado');
    expect(linhas).toHaveLength(3);
  });

  it('escapa campos com ponto e virgula usando aspas', () => {
    const linhas = [{ a: 'valor;com;pv', b: 'normal' }];
    const buf = exportReport(linhas, ['a', 'b'], { a: 'A', b: 'B' }, 'csv');
    const texto = buf.toString('utf-8');
    expect(texto).toContain('"valor;com;pv"');
  });

  it('escapa campos com aspas duplicando-as', () => {
    const linhas = [{ a: 'valor "com" aspas', b: 'ok' }];
    const buf = exportReport(linhas, ['a', 'b'], { a: 'A', b: 'B' }, 'csv');
    const texto = buf.toString('utf-8');
    expect(texto).toContain('"valor ""com"" aspas"');
  });

  it('retorna buffer vazio para linhas vazias (so cabecalho)', () => {
    const buf = exportReport([], COLUNAS, CABECALHOS, 'csv');
    const texto = buf.toString('utf-8').replace(/^﻿/, '');
    const linhas = texto.split('\n').filter((l) => l.length > 0);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toBe('Profissional;Paciente;Data;Status');
  });

  it('inclui BOM UTF-8 no inicio do CSV', () => {
    const buf = exportReport(LINHAS, COLUNAS, CABECALHOS, 'csv');
    expect(buf[0]).toBe(0xEF);
    expect(buf[1]).toBe(0xBB);
    expect(buf[2]).toBe(0xBF);
  });
});

describe('exportReport XLSX', () => {
  it('gera Buffer nao vazio com assinatura de arquivo XLSX (PK zip)', () => {
    const buf = exportReport(LINHAS, COLUNAS, CABECALHOS, 'xlsx');
    expect(buf.length).toBeGreaterThan(0);
    // ZIP magic bytes
    expect(buf[0]).toBe(0x50); // P
    expect(buf[1]).toBe(0x4B); // K
  });

  it('contem os dados quando reparseado', () => {
    const XLSX = require('xlsx');
    const buf = exportReport(LINHAS, COLUNAS, CABECALHOS, 'xlsx');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]!]!;
    const data = XLSX.utils.sheet_to_json(ws) as Record<string, string>[];
    expect(data).toHaveLength(2);
    expect(data[0]!['Profissional']).toBe('Dra. Ana');
    expect(data[1]!['Paciente']).toBe('Maria');
  });
});
