import type { E164, Provider, ProviderCtx, ProviderResult, Rfc3339 } from './common';

export interface PrescriptionItem {
  readonly nome: string;
  readonly principioAtivo: string | null;
  readonly concentracao: string | null;
  readonly forma: string | null;
  readonly quantidade: string | null;
  readonly posologia: string;
  readonly ehControlado: boolean;
}

export interface PrescriptionRecord {
  readonly providerPrescriptionId: string;
  readonly createdAt: Rfc3339;
  readonly patientLinkUrl: string;
  readonly validationCode: string;
  readonly pdfUrl: string;
  readonly items: readonly PrescriptionItem[];
  readonly structured: { readonly cid: string | null; readonly categoria: string | null } | null;
}

export interface PrescriberSession {
  readonly mode: 'embedded';
  readonly scriptUrl: string;
  readonly token: string;
  readonly expiresAt: Rfc3339;
  readonly patientPayload: Readonly<Record<string, string>>;
  readonly correlationId: string;
}

export interface PrescriptionProvider extends Provider {
  openPrescriberSession(ctx: ProviderCtx, i: {
    professional: { fullName: string; cpf: string; council: 'CRM' | 'CRO';
                    number: string; uf: string };
    patient: { fullName: string; birthDate?: string; cpf?: string; phone?: E164 };
    encounterId: string;
  }): Promise<ProviderResult<PrescriberSession>>;

  fetchPrescription(ctx: ProviderCtx, i: { providerPrescriptionId: string }):
    Promise<ProviderResult<PrescriptionRecord>>;

  fetchSignedArtifact(ctx: ProviderCtx, i: { providerPrescriptionId: string }):
    Promise<ProviderResult<{ bytes: Uint8Array; sha256: string; detachedP7s?: Uint8Array }>>;
}
