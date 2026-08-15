'use client';

import { useCallback, useEffect, useRef, type FormEvent } from 'react';

/**
 * O que um handler de clique/submit pode devolver. Devolver a promessa NÃO é
 * detalhe de estilo: é o que permite ao guard saber quando a ação terminou.
 */
export type ResultadoDeAcao = void | undefined | Promise<unknown>;

function ehPromessa(valor: unknown): valor is Promise<unknown> {
  return typeof (valor as { then?: unknown } | null | undefined)?.then === 'function';
}

export interface GuardaDeReentrada {
  /** `true` enquanto uma execução anterior ainda não terminou. */
  readonly bloqueado: () => boolean;
  /** Roda a ação segurando o guard até ela terminar. */
  readonly executar: <T>(acao: () => T) => T | undefined;
}

/**
 * Impede que a MESMA ação rode duas vezes por dois disparos do usuário.
 *
 * Por que `disabled={salvando}` não basta — e esta é a falha que gerou dois
 * documentos no prontuário:
 *
 * `setSalvando(true)` é estado do React, e estado só vira atributo `disabled`
 * no DOM depois do commit. Todo evento que o navegador já tinha enfileirado
 * ANTES desse commit chega a um botão que ainda está habilitado e chama o
 * handler de novo. Duplo clique de mouse, duplo toque em tela sensível, o
 * clique fantasma que o touch dispara ~300 ms depois do toque, `Enter`
 * segurado num formulário — todos caem nessa janela. O resultado é um POST
 * repetido: dois atestados assinados, dois lotes de faturamento, duas guias.
 *
 * `useRef` não tem essa janela. A escrita vale no mesmo instante, antes de
 * qualquer render, então o segundo disparo já encontra o guard fechado.
 *
 * O guard abre de novo quando:
 *
 * - a ação devolveu uma promessa → ao resolver OU rejeitar (é o caso forte:
 *   cobre a requisição inteira, mesmo sem nenhum estado de carregando na
 *   tela); ou
 * - a ação foi síncrona → no fim do tick, tempo suficiente para o React
 *   commitar o `disabled`/`carregando` da tela, que assume daí em diante.
 *
 * Por isso handler de mutação deve DEVOLVER a promessa (`onClick={() =>
 * salvar()}`) em vez de engoli-la (`onClick={() => { void salvar(); }}`).
 */
export function useGuardaDeReentrada(): GuardaDeReentrada {
  const emVooRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);

  const liberar = useCallback(() => {
    emVooRef.current = false;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const bloqueado = useCallback(() => emVooRef.current, []);

  const executar = useCallback(<T,>(acao: () => T): T | undefined => {
    if (emVooRef.current) return undefined;
    emVooRef.current = true;

    let resultado: T;
    try {
      resultado = acao();
    } catch (erro) {
      // Handler que estourou não deixou nada em voo: segurar o guard aqui
      // deixaria o botão morto até a próxima montagem.
      liberar();
      throw erro;
    }

    if (ehPromessa(resultado)) {
      // Libera nos dois desfechos, mas a rejeição SEGUE adiante. Tratá-la aqui
      // deixaria o guard como um `catch` global silencioso: toda falha de
      // salvamento sumiria do console e de qualquer captura em
      // `unhandledrejection`, e o bug viraria "salvou e não apareceu".
      resultado.then(liberar, (erro: unknown) => {
        liberar();
        throw erro;
      });
      return resultado;
    }

    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(liberar, 0);
    return resultado;
  }, [liberar]);

  return { bloqueado, executar };
}

/**
 * Versão pronta para handlers: devolve o mesmo handler protegido contra
 * reentrada. Para `<form onSubmit>`, onde não existe primitiva nossa no meio.
 */
export function useAcaoUnica<Args extends readonly unknown[]>(
  acao: (...args: Args) => ResultadoDeAcao,
): (...args: Args) => void {
  const guarda = useGuardaDeReentrada();
  const acaoRef = useRef(acao);
  // Guardado em ref para o handler devolvido ficar estável sem exigir
  // `useCallback` de quem chama — e sem rodar uma versão velha da ação.
  acaoRef.current = acao;

  return useCallback((...args: Args) => {
    guarda.executar(() => acaoRef.current(...args));
  }, [guarda]);
}

/**
 * `onSubmit` de `<form>` protegido contra envio repetido.
 *
 * O botão de submit já tem o guard do `Botao`, mas o formulário tem uma porta
 * própria: `Enter` num campo de texto envia sem passar por botão nenhum, e
 * `Enter` segurado repete no intervalo de autorrepetição do teclado (~30 ms),
 * bem dentro da janela em que `enviando` ainda não commitou.
 *
 * `preventDefault` roda SEMPRE, inclusive no envio barrado: sem ele o
 * formulário cairia na submissão nativa e navegaria por GET.
 */
export function useSubmitUnico(
  aoSubmeter: (evento: FormEvent<HTMLFormElement>) => ResultadoDeAcao,
): (evento: FormEvent<HTMLFormElement>) => void {
  const guardado = useAcaoUnica(aoSubmeter);
  return useCallback((evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    guardado(evento);
  }, [guardado]);
}
