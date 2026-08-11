import { describe, expect, it } from 'vitest';
import { parseCid10Csv } from './cid10';

describe('parseCid10Csv', () => {
  it('lê a estrutura oficial de subcategorias do DATASUS', () => {
    const csv = [
      'SUBCAT;CLASSIF;RESTRSEXO;CAUSAOBITO;DESCRICAO;DESCRABREV;REFER;EXCLUIDOS;',
      'J450;;;;Asma predominantemente alérgica;J45.0 Asma predom alérgica;;;',
      'I10;;;;Hipertensão essencial (primária);I10 Hipertensão essencial;;;',
    ].join('\n');

    expect(parseCid10Csv(csv)).toEqual([
      { codigo: 'J45.0', descricao: 'Asma predominantemente alérgica', capitulo: null },
      { codigo: 'I10', descricao: 'Hipertensão essencial (primária)', capitulo: null },
    ]);
  });

  it('mantém compatibilidade com o formato normalizado interno', () => {
    expect(parseCid10Csv('codigo;descricao;capitulo\nJ45;Asma;10\n')).toEqual([
      { codigo: 'J45', descricao: 'Asma', capitulo: 10 },
    ]);
  });
});
