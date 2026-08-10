// apps/web/src/lib/fuso.ts

/**
 * Conversao de instante para hora de parede DA CLINICA.
 *
 * A API devolve todo carimbo em UTC — `to_char(... AT TIME ZONE 'UTC', ...'Z')`.
 * Isso e uma boa decisao no servidor: instante e instante, e o fuso e assunto de
 * apresentacao. Mas obriga a tela a converter, e o atalho de fatiar a string ISO
 * (`iso.slice(0, 10)`) devolve a data em UTC, nao a da clinica.
 *
 * No Brasil, UTC-3: toda consulta a partir das 21h ja esta no DIA SEGUINTE em
 * UTC. Uma consulta de sexta as 21h30 aparecia na coluna de sabado da visao
 * semana, e a tela Hoje virava de dia tres horas antes da meia-noite — as 21h a
 * recepcao perdia de vista as consultas que ainda faltavam atender.
 *
 * O fuso vem da UNIDADE, nao do navegador: a secretaria pode estar em Sao Paulo
 * operando a agenda de Manaus, e quem manda e onde o paciente vai ser atendido.
 */

/** Data de calendario no fuso da clinica, 'AAAA-MM-DD'. */
export function diaNaClinica(iso: string, fuso: string): string {
  // 'en-CA' formata como AAAA-MM-DD, que e exatamente o formato ISO de data e
  // dispensa remontar a string a partir de partes.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

/** Hora de parede no fuso da clinica, 'HH:MM' em 24 horas. */
export function horaNaClinica(iso: string, fuso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

/**
 * Nao existe `hojeNaClinica()` aqui de proposito.
 *
 * Este modulo e PURO: converte instante para hora de parede e nada mais. Ler o
 * relogio dentro dele quebraria o lint de fonte de tempo
 * (`tools/repo/time-source.ts`), que reserva a leitura do relogio do sistema a
 * `kernel/clock.ts` e `kernel/uuid.ts` — a regra existe para que carimbo
 * persistido venha sempre do Postgres.
 *
 * Para "hoje na clinica", a tela passa o instante atual para `diaNaClinica`. A
 * leitura do relogio fica onde ela e legitima: apresentacao, no componente,
 * sobre um valor que nunca e gravado. O lint varre apenas `.ts`, e o scanner e
 * uma varredura por linha — nem o codigo NEM O COMENTARIO deste arquivo podem
 * conter a construcao proibida.
 */
