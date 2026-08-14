import { describe, it, expect } from 'vitest';
import { createFakeTeleconsultProvider } from './teleconsult-fake';
import type { ProviderCtx } from '../contracts/common';
import type { CreateRoomInput } from '../contracts/teleconsult';

const ctx: ProviderCtx = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  actorUserId: '00000000-0000-0000-0000-000000000002',
  requestId: 'req-1',
  idempotencyKey: 'idem-1',
  deadlineMs: 5000,
};

const input: CreateRoomInput = {
  appointmentId: '00000000-0000-0000-0000-000000000099',
  professionalName: 'Dr. Silva',
  patientName: 'Joao',
};

describe('teleconsult-fake', () => {
  it('creates room in ok mode', async () => {
    const p = createFakeTeleconsultProvider();
    const r = await p.createRoom(ctx, input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.roomId).toBe('fake-room-1');
    expect(r.value.roomUrl).toBe('https://fake-teleconsult/fake-room-1');
  });

  it('accumulates rooms', async () => {
    const p = createFakeTeleconsultProvider();
    await p.createRoom(ctx, input);
    await p.createRoom(ctx, { ...input, appointmentId: 'other' });
    expect(p.rooms).toHaveLength(2);
    expect(p.rooms[1]!.input.appointmentId).toBe('other');
  });

  it('increments roomId counter', async () => {
    const p = createFakeTeleconsultProvider();
    await p.createRoom(ctx, input);
    const r = await p.createRoom(ctx, input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.roomId).toBe('fake-room-2');
  });

  it('returns unavailable in indisponivel mode', async () => {
    const p = createFakeTeleconsultProvider({ modo: 'indisponivel' });
    const r = await p.createRoom(ctx, input);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('unavailable');
  });

  it('returns timeout in timeout mode', async () => {
    const p = createFakeTeleconsultProvider({ modo: 'timeout' });
    const r = await p.createRoom(ctx, input);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('timeout');
  });

  it('health returns up:true in ok mode', async () => {
    const p = createFakeTeleconsultProvider();
    const h = await p.health();
    expect(h.up).toBe(true);
  });

  it('health returns up:false in indisponivel mode', async () => {
    const p = createFakeTeleconsultProvider({ modo: 'indisponivel' });
    const h = await p.health();
    expect(h.up).toBe(false);
  });

  it('stores ctx and input in accumulated rooms', async () => {
    const p = createFakeTeleconsultProvider();
    await p.createRoom(ctx, input);
    expect(p.rooms[0]!.ctx.tenantId).toBe(ctx.tenantId);
    expect(p.rooms[0]!.input.professionalName).toBe('Dr. Silva');
  });
});
