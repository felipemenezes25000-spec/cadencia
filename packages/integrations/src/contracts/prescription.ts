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
 * Um artefato documental da prescricao, como o provedor o descreve.
 *
 * E aqui que mora a PROVA de assinatura. O `signed` da prescricao diz que ela
 * foi assinada; `documents[]` diz QUAL arquivo carrega a assinatura e com que
 * hash — e e isso que permite, em 2046, afirmar que o PDF do acervo e o mesmo
 * que foi assinado, mesmo que o provedor nao exista mais.
 */
export interface PrescriptionDocument {
  readonly documentId: string;
  readonly uuid: string;
  /** 'full', 'signature', e outros que o provedor venha a emitir. */
  readonly type: string;
  readonly status: string;
  readonly signed: boolean;
  readonly fileName: string;
  /** Hash informado pelo PROVEDOR. O nosso e calculado sobre os bytes baixados. */
  readonly fileHash: string | null;
}

export interface PrescriptionRecord {
  readonly providerPrescriptionId: string;
  /** UUID do provedor. Estavel entre ambientes; o id numerico nao e. */
  readonly providerPrescriptionUuid: string | null;
  readonly createdAt: Rfc3339;
  readonly patientLinkUrl: string;
  readonly validationCode: string;
  readonly pdfUrl: string;
  /**
   * A prescricao foi assinada digitalmente.
   *
   * NAO e derivavel da existencia do QR Code: o QR leva a Receita Digital e
   * existe mesmo em receita que sera assinada a mao depois. Confundir os dois e
   * o erro que faz um sistema arquivar como "assinada" uma receita que nao esta.
   *
   * Para medicamento sob controle especial (Portaria 344/1998) a assinatura
   * qualificada ICP-Brasil e EXIGIDA — assinatura avancada do gov.br nao serve.
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
 * Quem prescreveu. Sai como parametro porque a leitura server-side de uma
 * prescricao, em pelo menos um provedor real (Memed), e autorizada pelo token
 * DAQUELE prescritor e nao por credencial da plataforma: sem identificar o
 * medico, nao ha como buscar a verdade sobre o que ele emitiu.
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
