import { randomUUID } from 'node:crypto';
import { isoFromMs, systemClock } from '@cadencia/kernel';
import { asRfc3339, success, type Rfc3339 } from '../contracts/common';
import type { TeleconsultProvider } from '../contracts/teleconsult';

function agora(): Rfc3339 {
  return asRfc3339(isoFromMs(systemClock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
}

export function createJitsiTeleconsultProvider(): TeleconsultProvider {
  return {
    id: 'teleconsult-jitsi',
    capabilities: new Set(['residency:br']),
    safety: { createRoom: 'safe' },

    async health() {
      return { up: true, latencyMs: 0, checkedAt: agora() };
    },

    async createRoom(_ctx, input) {
      const short = randomUUID().slice(0, 8);
      const roomId = `cadencia-${input.appointmentId.slice(0, 8)}-${short}`;
      const roomUrl = `https://meet.jit.si/${roomId}`;
      return success({ roomId, roomUrl }, roomId);
    },
  };
}
