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

/**
 * Um artefato documental da prescrição, como o provedor o descreve.
 *
 * É aqui que mora a PROVA de assinatura. O `signed` da prescrição diz que ela
 * foi assinada; `documents[]` diz QUAL arquivo carrega a assinatura e com que
 * hash — e é isso que permite, em 2046, afirmar que o PDF do acervo é o mesmo
 * que foi assinado, mesmo que o provedor não exista mais.
 */
export interface PrescriptionDocument {
  readonly documentId: string;
  readonly uuid: string;
  /** 'full', 'signature', e outros que o provedor venha a emitir. */
  readonly type: string;
  readonly status: string;
  readonly signed: boolean;
  readonly fileName: string;
  /** Hash informado pelo PROVEDOR. O nosso é calculado sobre os bytes baixados. */
  readonly fileHash: string | null;
}

export interface PrescriptionRecord {
  readonly providerPrescriptionId: string;
  /** UUID do provedor. Estável entre ambientes; o id numérico não é. */
  readonly providerPrescriptionUuid: string | null;
  readonly createdAt: Rfc3339;
  readonly patientLinkUrl: string;
  readonly validationCode: string;
  readonly pdfUrl: string;
  /**
   * A prescrição foi assinada digitalmente.
   *
   * NÃO é derivável da existência do QR Code: o QR leva a Receita Digital e
   * existe mesmo em receita que será assinada à mão depois. Confundir os dois é
   * o erro que faz um sistema arquivar como "assinada" uma receita que não está.
   *
   * Para medicamento sob controle especial (Portaria 344/1998) a assinatura
   * qualificada ICP-Brasil é EXIGIDA — assinatura avançada do gov.br não serve.
   */
  readonly signed: boolean;
  readonly documents: readonly PrescriptionDocument[];
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

/**
 * Quem prescreveu. Sai como parâmetro porque a leitura server-side de uma
 * prescrição, em pelo menos um provedor real (Memed), é autorizada pelo token
 * DAQUELE prescritor e não por credencial da plataforma: sem identificar o
 * médico, não há como buscar a verdade sobre o que ele emitiu.
 */
export interface PrescriberRef {
  readonly fullName: string;
  readonly cpf: string;
  readonly council: 'CRM' | 'CRO';
  readonly number: string;
  readonly uf: string;
}

export interface PrescriptionProvider extends Provider {
  openPrescriberSession(ctx: ProviderCtx, i: {
    professional: PrescriberRef;
    patient: { fullName: string; birthDate?: string; cpf?: string; phone?: E164 };
    encounterId: string;
  }): Promise<ProviderResult<PrescriberSession>>;

  fetchPrescription(ctx: ProviderCtx, i: {
    providerPrescriptionId: string;
    prescriberRef?: PrescriberRef;
  }): Promise<ProviderResult<PrescriptionRecord>>;

  fetchSignedArtifact(ctx: ProviderCtx, i: {
    providerPrescriptionId: string;
    prescriberRef?: PrescriberRef;
  }): Promise<ProviderResult<{ bytes: Uint8Array; sha256: string; detachedP7s?: Uint8Array }>>;
}
