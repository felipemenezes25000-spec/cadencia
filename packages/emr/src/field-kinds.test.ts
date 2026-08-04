import { describe, expect, it } from 'vitest';
import { FIELD_KINDS, slotOf, promotesTo, isMultiRow, FIELD_KIND_LIST } from './field-kinds';

describe('tipos de campo do prontuario', () => {
  it('sao exatamente os 15 tipos da §4.2, na ordem da tabela', () => {
    expect(FIELD_KIND_LIST).toEqual([
      'texto_longo', 'texto_curto', 'numerico', 'composto', 'booleano', 'data',
      'lista_unica', 'multipla_escolha', 'busca_tabela', 'imc', 'dpp_ig',
      'curva_crescimento', 'odontograma', 'oculos', 'orcamento',
    ]);
  });

  it('cada tipo cai no slot certo da encounter_field_value', () => {
    expect(slotOf('texto_longo')).toBe('value_text');
    expect(slotOf('numerico')).toBe('value_num');
    expect(slotOf('booleano')).toBe('value_bool');
    expect(slotOf('data')).toBe('value_date');
    expect(slotOf('lista_unica')).toBe('value_ref_code');
    expect(slotOf('multipla_escolha')).toBe('value_ref_code');
    expect(slotOf('busca_tabela')).toBe('value_ref_code');
    expect(slotOf('imc')).toBe('value_num');
    expect(slotOf('odontograma')).toBe('value_json');
  });

  it('composto nao tem slot proprio — ele vira N linhas de componente', () => {
    expect(slotOf('composto')).toBeNull();
  });

  it('promove para a tabela de primeira classe correta', () => {
    expect(promotesTo('numerico')).toBe('observation');
    expect(promotesTo('imc')).toBe('observation');
    expect(promotesTo('composto')).toBe('observation');
    expect(promotesTo('lista_unica')).toBe('encounter_finding');
    expect(promotesTo('multipla_escolha')).toBe('encounter_finding');
    expect(promotesTo('busca_tabela')).toBe('coded');
    expect(promotesTo('texto_longo')).toBeNull();
    expect(promotesTo('odontograma')).toBeNull();
  });

  it('multipla_escolha e composto geram N linhas — o resto gera uma so', () => {
    expect(isMultiRow('multipla_escolha')).toBe(true);
    expect(isMultiRow('composto')).toBe(true);
    expect(isMultiRow('lista_unica')).toBe(false);
    expect(isMultiRow('texto_longo')).toBe(false);
  });

  it('todo tipo do enum do banco tem entrada no mapa', () => {
    for (const k of FIELD_KIND_LIST) {
      expect(FIELD_KINDS[k], `tipo ${k} sem definicao`).toBeDefined();
    }
  });
});
