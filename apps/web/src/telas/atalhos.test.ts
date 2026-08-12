import { describe, expect, it } from 'vitest';
import { gatilhoDe, ATALHOS_DO_ATENDIMENTO, deveIgnorarTeclaSimples } from './atalhos';

describe('atalhos do atendimento', () => {
  it('# busca código, / expande modelo, @ traz valor anterior', () => {
    expect(gatilhoDe('#hipert')).toEqual({ tipo: 'codigo', termo: 'hipert' });
    expect(gatilhoDe('/retorno')).toEqual({ tipo: 'modelo', termo: 'retorno' });
    expect(gatilhoDe('@peso')).toEqual({ tipo: 'valor_anterior', termo: 'peso' });
    expect(gatilhoDe('texto comum')).toBeNull();
  });

  it('cobre os atalhos com modificador da §5.6', () => {
    expect(ATALHOS_DO_ATENDIMENTO.map((a) => a.combinacao)).toEqual([
      'Ctrl+R', 'Ctrl+E', 'Ctrl+D', 'Ctrl+I', 'Ctrl+;', 'Ctrl+$',
      'Ctrl+ArrowUp', 'Ctrl+ArrowDown', 'Ctrl+Enter']);
  });

  it('DISCIPLINA DE FOCO: tecla simples NÃO dispara dentro de campo de texto', () => {
    expect(deveIgnorarTeclaSimples({ tagName: 'INPUT', isContentEditable: false })).toBe(true);
    expect(deveIgnorarTeclaSimples({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(deveIgnorarTeclaSimples({ tagName: 'DIV', isContentEditable: false })).toBe(false);
  });

  it('Ctrl+; insere data e hora DO SERVIDOR, nunca do relógio do cliente', () => {
    const a = ATALHOS_DO_ATENDIMENTO.find((x) => x.combinacao === 'Ctrl+;');
    expect(a?.acao).toBe('inserir_data_hora_do_servidor');
  });

  it('Ctrl+$ abre a cobrança no atendimento', () => {
    const a = ATALHOS_DO_ATENDIMENTO.find((x) => x.combinacao === 'Ctrl+$');
    expect(a?.acao).toBe('cobrar');
    expect(a?.descricao).toBe('Cobrar');
  });
});
