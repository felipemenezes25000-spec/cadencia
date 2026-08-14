import { isoFromMs, systemClock } from '@cadencia/kernel';
import {
  asRfc3339, failure, success,
  type ProviderCtx, type ProviderResult, type Rfc3339,
} from '../contracts/common';
import type { CreateRoomInput, TeleconsultProvider, TeleconsultRoom } from '../contracts/teleconsult';

export type ModoFakeTeleconsult = 'ok' | 'indisponivel' | 'timeout';

export interface FakeTeleconsultOptions {
  readonly modo?: ModoFakeTeleconsult;
}

export interface CreatedRoom {
  readonly ctx: ProviderCtx;
  readonly input: CreateRoomInput;
  readonly roomId: string;
  readonly roomUrl: string;
}

function agora(): Rfc3339 {
  return asRfc3339(isoFromMs(systemClock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
}

export function createFakeTeleconsultProvider(
  opts: FakeTeleconsultOptions = {},
): TeleconsultProvider & { readonly rooms: readonly CreatedRoom[] } {
  const modo = opts.modo ?? 'ok';

  function falha<T>(): ProviderResult<T> | null {
    if (modo === 'indisponivel') {
      return failure<T>({ kind: 'unavailable', retrySafe: true, retryAfterMs: 5000,
                          detail: 'teleconsult fake indisponivel' });
    }
    if (modo === 'timeout') {
      return failure<T>({ kind: 'timeout', retrySafe: false,
                          detail: 'deadline estourou' });
    }
    return null;
  }

  const roomList: CreatedRoom[] = [];
  let counter = 0;

  return {
    id: 'teleconsult-fake',
    capabilities: new Set(['residency:br']),
    safety: { createRoom: 'safe' },

    get rooms(): readonly CreatedRoom[] {
      return roomList;
    },

    async health() {
      return { up: modo === 'ok', latencyMs: 1, checkedAt: agora() };
    },

    async createRoom(ctx: ProviderCtx, input: CreateRoomInput) {
      const f = falha<TeleconsultRoom>();
      if (f) return f;

      counter += 1;
      const roomId = `fake-room-${counter}`;
      const roomUrl = `https://fake-teleconsult/${roomId}`;
      roomList.push({ ctx, input, roomId, roomUrl });
      return success({ roomId, roomUrl }, roomId);
    },
  };
}
