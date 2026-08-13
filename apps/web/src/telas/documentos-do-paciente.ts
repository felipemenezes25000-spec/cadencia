export interface DocumentoResumoCarregado {
  readonly id: string;
  readonly origem: 'emitido' | 'anexo';
  readonly titulo: string;
  readonly categoria: string;
  readonly criadoEm: string;
  readonly tamanhoBytes: number | null;
  readonly assinado: boolean;
}

export interface DocumentoEmitidoDaApi {
  readonly documentId: string;
  readonly kind: string;
  readonly titulo: string;
  readonly issuedDate: string;
  readonly createdAt: string;
  readonly assinado: boolean;
}

export interface AnexoDaApi {
  readonly attachmentId: string;
  readonly kind: string;
  readonly originalName: string;
  readonly sizeBytes: number;
  readonly criadoEm: string;
}

const ROTULOS_DOCUMENTO: Readonly<Record<string, string>> = {
  atestado: 'Atestado médico',
  pedido_exame: 'Pedido de exame',
  relatorio: 'Relatório médico',
  declaracao_comparecimento: 'Declaração de comparecimento',
};

const ROTULOS_ANEXO: Readonly<Record<string, string>> = {
  resultado_exame: 'Resultado de exame',
  imagem: 'Imagem clínica',
  documento_externo: 'Documento externo',
  consentimento: 'Consentimento',
  outro: 'Outro arquivo',
};

/**
 * Documento emitido e anexo têm permissões diferentes. Uma recepcionista pode
 * reimprimir o primeiro sem poder abrir o segundo, então falha de anexo não
 * apaga a coleção de documentos legitimamente acessível.
 */
export async function carregarDocumentosDoPaciente(
  carregarEmitidos: () => Promise<{ itens: DocumentoEmitidoDaApi[] }>,
  carregarAnexos: () => Promise<{ itens: AnexoDaApi[] }>,
): Promise<DocumentoResumoCarregado[]> {
  const [emitidos, anexos] = await Promise.allSettled([carregarEmitidos(), carregarAnexos()]);
  if (emitidos.status === 'rejected') throw emitidos.reason;

  const itens: DocumentoResumoCarregado[] = [
    ...emitidos.value.itens.map((item) => ({
      id: item.documentId,
      origem: 'emitido' as const,
      titulo: item.titulo,
      categoria: ROTULOS_DOCUMENTO[item.kind] ?? 'Documento clínico',
      criadoEm: item.createdAt || item.issuedDate,
      tamanhoBytes: null,
      assinado: item.assinado,
    })),
    ...(anexos.status === 'fulfilled' ? anexos.value.itens.map((item) => ({
      id: item.attachmentId,
      origem: 'anexo' as const,
      titulo: item.originalName,
      categoria: ROTULOS_ANEXO[item.kind] ?? 'Arquivo clínico',
      criadoEm: item.criadoEm,
      tamanhoBytes: item.sizeBytes,
      assinado: false,
    })) : []),
  ];
  return itens.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}
