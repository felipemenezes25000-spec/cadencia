/**
 * Hooks otimizados para polling e real-time.
 *
 * - usePolling: polling inteligente que para quando tab está hidden
 * - useOptimisticMutation: optimistic update para mutations
 * - useRefetchOnFocus: revalida queries ao voltar para a página
 */

import {
  useMutation,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

/* ── tipos ──────────────────────────────────────────────────────── */

interface PollingOptions {
  /** Intervalo em ms (default: 30_000) */
  interval?: number;
  /** Se deve parar quando hidden (default: true) */
  stopWhenHidden?: boolean;
  /** Condição para continuar polando */
  enabled?: boolean;
}

/* ── polling inteligente ──────────────────────────────────────── */

/**
 * Polling que PARA quando a tab está escondida para economizar resources.
 * Retoma quando o usuário volta.
 */
export function usePolling(
  callback: () => void | Promise<void>,
  options: PollingOptions = {},
) {
  const {
    interval = 30_000,
    stopWhenHidden = true,
    enabled = true,
  } = options;

  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    function tick() {
      void callbackRef.current();
    }

    function start() {
      if (intervalRef.current) return;
      intervalRef.current = setInterval(tick, interval);
      tick();
    }

    function stop() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    if (stopWhenHidden) {
      if (document.visibilityState === 'visible') {
        start();
      }
      const handleVisibility = () => {
        if (document.visibilityState === 'visible') {
          tick(); // refetch imediato ao voltar
          start();
        } else {
          stop();
        }
      };
      document.addEventListener('visibilitychange', handleVisibility);
      return () => {
        stop();
        document.removeEventListener('visibilitychange', handleVisibility);
      };
    }

    start();
    return stop;
  }, [interval, stopWhenHidden, enabled]);
}

/* ── optimistic update ─────────────────────────────────────────── */

/**
 * Mutation com optimistic update integrado.
 *
 * Uso:
 * ```tsx
 * const mutation = useOptimisticMutation({
 *   mutationFn: (novoStatus) => api.patch(`/agenda/${id}`, { status: novoStatus }),
 *   queryKey: ['agenda', dia],
 *   optimisticUpdate: (old, vars) => ({
 *     ...old,
 *     status: vars,
 *   }),
 * });
 * ```
 */
export function useOptimisticMutation<TData, TError, TVariables>(
  options: UseMutationOptions<TData, TError, TVariables> & {
    /** Query key para invalidar */
    queryKey?: unknown[];
    /** Função que calcula o novo valor da query */
    optimisticUpdate?: (
      current: TData,
      variables: TVariables,
    ) => TData;
    /** Inversão em caso de falha (default: true) */
    rollbackOnError?: boolean;
  },
) {
  const {
    queryKey,
    optimisticUpdate,
    rollbackOnError = true,
    ...mutationOptions
  } = options;

  const client = useQueryClient();

  return useMutation({
    ...mutationOptions,
    onMutate: async (variables) => {
      // Cancelar refetches pendentes
      if (queryKey) {
        await client.cancelQueries({ queryKey });
      }

      // Snapshot para rollback (guarda fora para usar no onError)
      const snapshot = queryKey
        ? client.getQueryData<TData>(queryKey)
        : undefined;

      // Aplicar optimistic update
      if (queryKey && optimisticUpdate) {
        const current = client.getQueryData<TData>(queryKey);
        if (current) {
          client.setQueryData<TData>(
            queryKey,
            (old) => old ? optimisticUpdate(old, variables) : old,
          );
        }
      }

      // Guardar snapshot no context para rollback
      return { snapshot };
    },
    onError: (_err, _variables, context) => {
      // Rollback se falhou
      const ctx = context as { snapshot?: TData } | undefined;
      if (queryKey && rollbackOnError && ctx?.snapshot !== undefined) {
        client.setQueryData(queryKey, ctx.snapshot);
      }
    },
    onSettled: (_data, _err, _variables) => {
      // Revalidar para garantir consistência
      if (queryKey) {
        client.invalidateQueries({ queryKey });
      }
    },
  });
}

/* ── invalidar ao focar ────────────────────────────────────────── */

/**
 * Revalida queries específicas quando a janela ganha foco.
 */
export function useRefetchOnFocus(queryKeys: unknown[][]) {
  const client = useQueryClient();

  useEffect(() => {
    function onFocus() {
      for (const key of queryKeys) {
        client.invalidateQueries({ queryKey: key });
      }
    }

    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [client, queryKeys]);
}
