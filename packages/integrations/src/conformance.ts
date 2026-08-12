import type { Provider } from './contracts/common';

export function assertSafetyDeclared(p: Provider, metodos: readonly string[]): boolean {
  for (const m of metodos) {
    if (p.safety[m] === undefined) {
      throw new Error(`${p.id}: safety não declarada para ${m}`);
    }
  }
  return true;
}

export interface TimeoutScenario {
  operacao: () => Promise<{ estado: 'ok'; id: string } | { estado: 'timeout' }>;
  reconciliar: () => Promise<{ jaExiste: boolean; id: string | null }>;
  simularEfeitoNoTimeout?: boolean;
}

export interface TimeoutOutcome {
  readonly duplicou: boolean;
  readonly id: string | null;
  readonly viaReconciliacao: boolean;
}

export async function assertNoDuplicateOnTimeout(
  cenario: TimeoutScenario,
): Promise<TimeoutOutcome> {
  const primeira = await cenario.operacao();

  if (primeira.estado === 'ok') {
    if (cenario.simularEfeitoNoTimeout === true) {
      const segunda = await cenario.operacao();
      if (segunda.estado === 'ok' && segunda.id !== primeira.id) {
        throw new Error(
          `adaptador duplicou: primeira chamada gerou ${primeira.id}, segunda gerou ${segunda.id}`);
      }
    }
    return { duplicou: false, id: primeira.id, viaReconciliacao: false };
  }

  const rec = await cenario.reconciliar();
  if (rec.jaExiste) {
    return { duplicou: false, id: rec.id, viaReconciliacao: true };
  }

  const reenvio = await cenario.operacao();
  if (reenvio.estado !== 'ok') {
    return { duplicou: false, id: null, viaReconciliacao: true };
  }
  return { duplicou: false, id: reenvio.id, viaReconciliacao: true };
}
