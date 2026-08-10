import { describe, expect, it } from 'vitest';
import { expandirRecorrencia } from './recorrencia';

/**
 * A expansao trabalha em HORA DE PAREDE, nao em instante.
 *
 * "Toda terca as 14h" e um compromisso com o relogio da clinica. Expandir em
 * UTC e converter depois faria o horario ANDAR se o pais reinstituir horario de
 * verao no meio da serie — o paciente marcado para as 14h apareceria as 15h. A
 * conversao para instante acontece no Postgres, que conhece as regras do fuso;
 * aqui so se conta dia de calendario.
 */
describe('expandirRecorrencia', () => {
  it('semanal mantem o dia da semana', () => {
    const r = expandirRecorrencia({
      primeiraData: '2026-08-11', hora: '14:00', freq: 'semanal',
      intervalo: 1, horizonteAte: '2026-09-08',
    });
    expect(r).toEqual([
      '2026-08-11T14:00', '2026-08-18T14:00', '2026-08-25T14:00',
      '2026-09-01T14:00', '2026-09-08T14:00',
    ]);
  });

  it('o horizonte e inclusivo — o ultimo dia conta', () => {
    const r = expandirRecorrencia({
      primeiraData: '2026-08-11', hora: '09:00', freq: 'semanal',
      intervalo: 1, horizonteAte: '2026-08-18',
    });
    // Excluir o ultimo dia faria a recepcao marcar "ate 18/08" e o paciente
    // ficar sem a consulta do dia 18.
    expect(r).toHaveLength(2);
    expect(r[1]).toBe('2026-08-18T09:00');
  });

  it('quinzenal e de 14 em 14 dias, para nao trocar o dia da semana', () => {
    const r = expandirRecorrencia({
      primeiraData: '2026-08-11', hora: '14:00', freq: 'quinzenal',
      intervalo: 1, horizonteAte: '2026-09-30',
    });
    // "De 15 em 15" trocaria terca por quarta na segunda ocorrencia, e a agenda
    // do profissional deixaria de bater com a rotina dele.
    expect(r).toEqual([
      '2026-08-11T14:00', '2026-08-25T14:00', '2026-09-08T14:00',
      '2026-09-22T14:00',
    ]);
  });

  it('diaria com intervalo pula os dias certos', () => {
    const r = expandirRecorrencia({
      primeiraData: '2026-08-11', hora: '08:00', freq: 'diaria',
      intervalo: 3, horizonteAte: '2026-08-20',
    });
    expect(r).toEqual([
      '2026-08-11T08:00', '2026-08-14T08:00', '2026-08-17T08:00',
      '2026-08-20T08:00',
    ]);
  });

  it('mensal mantem o dia do mes', () => {
    const r = expandirRecorrencia({
      primeiraData: '2026-03-15', hora: '10:30', freq: 'mensal',
      intervalo: 1, horizonteAte: '2026-06-15',
    });
    expect(r).toEqual([
      '2026-03-15T10:30', '2026-04-15T10:30', '2026-05-15T10:30',
      '2026-06-15T10:30',
    ]);
  });

  it('mensal do dia 31 cai no ultimo dia dos meses curtos', () => {
    const r = expandirRecorrencia({
      primeiraData: '2026-01-31', hora: '10:00', freq: 'mensal',
      intervalo: 1, horizonteAte: '2026-04-30',
    });
    // Pular fevereiro deixaria o paciente dois meses sem retorno sem ninguem
    // decidir isso. O ultimo dia do mes e o que a recepcao marcaria no papel.
    expect(r).toEqual([
      '2026-01-31T10:00', '2026-02-28T10:00', '2026-03-31T10:00',
      '2026-04-30T10:00',
    ]);
  });

  it('o dia 31 volta a valer nos meses que o tem', () => {
    const r = expandirRecorrencia({
      primeiraData: '2026-01-31', hora: '10:00', freq: 'mensal',
      intervalo: 1, horizonteAte: '2026-03-31',
    });
    // Aparar para 28 e ARRASTAR o resto da serie transformaria "todo dia 31" em
    // "todo dia 28" a partir de fevereiro. O dia pedido e sempre a referencia.
    expect(r[2]).toBe('2026-03-31T10:00');
  });

  it('horizonte antes da primeira data devolve a primeira mesmo assim', () => {
    const r = expandirRecorrencia({
      primeiraData: '2026-08-11', hora: '14:00', freq: 'semanal',
      intervalo: 1, horizonteAte: '2026-08-01',
    });
    // O agendamento de hoje nao pode sumir porque alguem errou o horizonte.
    expect(r).toEqual(['2026-08-11T14:00']);
  });

  it('recusa serie que nao cabe na agenda de ninguem', () => {
    // Diaria por tres anos sao mais de mil linhas em `sched.appointment`, cada
    // uma disputando o indice de sobreposicao. Recusar aqui protege o banco de
    // um clique distraido; a recepcao remarca o horizonte.
    expect(() => expandirRecorrencia({
      primeiraData: '2026-01-01', hora: '08:00', freq: 'diaria',
      intervalo: 1, horizonteAte: '2029-01-01',
    })).toThrow(/limite/i);
  });
});
