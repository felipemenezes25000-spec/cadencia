import type { Provider, ProviderCtx, ProviderResult } from './common';

export interface CreateRoomInput {
  readonly appointmentId: string;
  readonly professionalName: string;
  readonly patientName: string;
}

export interface TeleconsultRoom {
  readonly roomId: string;
  readonly roomUrl: string;
}

export interface TeleconsultProvider extends Provider {
  createRoom(ctx: ProviderCtx, input: CreateRoomInput):
    Promise<ProviderResult<TeleconsultRoom>>;
}
