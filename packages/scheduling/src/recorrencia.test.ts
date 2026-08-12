import { describe, expect, it } from 'vitest';
import { expandirRecorrencia } from './recorrencia';

/**
 * A expansão trabalha em HORA DE PAREDE, não em instante.
 *
 * "Toda terça as 14h" é um compromisso com o relógio da clínica. Expandir em
 * UTC e converter depois faria o horário ANDAR se o país reinstituir horário de
 * verão no meio da série — o paciente marcado para as 14h apareceria as 15h. A
 * conversão para instante acontece no Postgres, que conhece as regras do fuso;
 * aqui só se conta dia de calendário.
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
    // Excluir o último dia faria a recepção marcar "até 18/08" e o paciente
    // ficar sem a consulta do dia 18.
    expect(r).toHaveLength(2);
    expect(r[1]).toBe('2026-08-18T09:00');
  });

  it('quinzenal e de 14 em 14 dias, para nao trocar o dia da semana', () => {
    const r = expandirRecorrencia({
      primeiraData: '2026-08-11', hora: '14:00', freq: 'quinzenal',
      intervalo: 1, horizonteAte: '2026-09-30',
    });
    // "De 15 em 15" trocaria terça por quarta na segunda ocorrência, e a agenda
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
    // Pular fevereiro deixaria o paciente dois meses sem retorno sem ninguém
    // decidir isso. O último dia do mês é o que a recepção marcaria no papel.
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
    // Aparar para 28 e ARRASTAR o resto da série transformaria "todo dia 31" em
    // "todo dia 28" a partir de fevereiro. O dia pedido é sempre a referência.
    expect(r[2]).toBe('2026-03-31T10:00');
  });

  it('horizonte antes da primeira data devolve a primeira mesmo assim', () => {
    const r = expandirRecorrencia({
      primeiraData: '2026-08-11', hora: '14:00', freq: 'semanal',
      intervalo: 1, horizonteAte: '2026-08-01',
    });
    // O agendamento de hoje não pode sumir porque alguém errou o horizonte.
    expect(r).toEqual(['2026-08-11T14:00']);
  });

  it('recusa serie que nao cabe na agenda de ninguem', () => {
    // Diária por três anos são mais de mil linhas em `sched.appointment`, cada
    // uma disputando o índice de sobreposição. Recusar aqui protege o banco de
    // um clique distraído; a recepção remarca o horizonte.
    expect(() => expandirRecorrencia({
      primeiraData: '2026-01-01', hora: '08:00', freq: 'diaria',
      intervalo: 1, horizonteAte: '2029-01-01',
    })).toThrow(/limite/i);
  });
});
