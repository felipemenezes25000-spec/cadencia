import {
  createUncontractedSignatureProvider,
  createFakeTranscriptionProvider, createOpenAiTranscriptionProvider,
  type TranscriptionProvider,
  createFakePrescriptionProvider, createFakeSignatureProvider,
  createFakeMessagingProvider, createFakePaymentProvider,
  createMemedProvider,
  type PrescriptionProvider, type SignatureProvider,
  type MessagingProvider, type PaymentProvider,
} from '@cadencia/integrations';

export interface Providers {
  readonly signature: SignatureProvider;
  readonly prescription: PrescriptionProvider;
  readonly messaging: MessagingProvider;
  readonly payment: PaymentProvider;
  readonly transcription: TranscriptionProvider;
}

let cache: Providers | null = null;

function exigir(nome: string): string {
  const v = process.env[nome];
  if (v === undefined || v === '') {
    throw new Error(`${nome} ausente — obrigatoria com CADENCIA_PROVIDERS=real`);
  }
  return v;
}

/**
 * A troca fake→real e por variavel de ambiente e vale para o processo inteiro.
 *
 * Nao existe modo misto por engano: `real` exige TODOS os adaptadores reais
 * disponiveis e falha alto no boot se faltar credencial. Um sistema que sobe
 * com prescricao real e assinatura fake emite receita que nao vale nada — e o
 * medico so descobre quando a farmacia recusa.
 */
/**
 * OpenAI quando ha chave; fake quando nao ha.
 *
 * Nao lanca sem a chave, ao contrario dos outros: transcricao e ASSISTENCIA. A
 * clinica que nao contratou continua atendendo — so nao ganha o rascunho pronto.
 * Derrubar o boot por causa disso trocaria uma comodidade ausente por um sistema
 * fora do ar.
 */
function transcricaoConfigurada(): TranscriptionProvider {
  const chave = process.env['OPENAI_API_KEY'];
  if (chave === undefined || chave === '') return createFakeTranscriptionProvider();
  return createOpenAiTranscriptionProvider({ apiKey: chave });
}

export function providers(): Providers {
  if (cache !== null) return cache;

  const modo = process.env['CADENCIA_PROVIDERS'];

  /**
   * Modo intermediario: Memed real, o resto fake.
   *
   * `real` e tudo-ou-nada e trava no boot enquanto nao existir adaptador
   * ICP-Brasil — o que significa que a Memed nunca poderia ser ligada. A trava
   * estava protegendo o documento errado: para RECEITA, a propria Memed e a
   * camada de assinatura qualificada; o adaptador ICP-Brasil que falta e para
   * ATESTADO e demais documentos.
   *
   * A assinatura NAO vira fake: vira o provedor que RECUSA. O fake assina com
   * sucesso e reporta `valida`, o que gravaria atestado com estado `assinado` e
   * sem valor legal — indistinguivel de ICP-Brasil real no banco. Recusando, o
   * documento e emitido e fica explicitamente PENDENTE de assinatura.
   */
  if (modo === 'memed') {
    process.stderr.write(
      '[providers] MEMED REAL, assinatura FAKE. Receita vale; atestado NAO.\n');
    const soMemed: Providers = {
      prescription: createMemedProvider({
        baseUrl: exigir('MEMED_BASE_URL'),
        scriptUrl: exigir('MEMED_SCRIPT_URL'),
        apiKey: exigir('MEMED_API_KEY'),
        secretKey: exigir('MEMED_SECRET_KEY'),
      }),
      signature: createUncontractedSignatureProvider(),
      messaging: createFakeMessagingProvider({ appSecret: exigir('WHATSAPP_APP_SECRET') }),
      payment: createFakePaymentProvider({ webhookSecret: exigir('PSP_WEBHOOK_SECRET') }),
      transcription: transcricaoConfigurada(),
    };
    cache = soMemed;
    return soMemed;
  }

  if (modo !== 'real') {
    const comFakes: Providers = {
      signature: createFakeSignatureProvider(),
      prescription: createFakePrescriptionProvider(),
      messaging: createFakeMessagingProvider(),
      payment: createFakePaymentProvider(),
      transcription: createFakeTranscriptionProvider(),
    };
    cache = comFakes;
    return comFakes;
  }

  const reais: Providers = {
    prescription: createMemedProvider({
      // A base ja inclui /v1. Homologacao e producao sao hosts diferentes, e a
      // diferenca entre eles e "receita de teste" contra "receita que a farmacia
      // dispensa": nunca deduzir, sempre configurar.
      baseUrl: exigir('MEMED_BASE_URL'),
      scriptUrl: exigir('MEMED_SCRIPT_URL'),
      apiKey: exigir('MEMED_API_KEY'),
      secretKey: exigir('MEMED_SECRET_KEY'),
    }),
    // Ainda sem adaptador de PSC. Antes isto LANCAVA no boot, e travar o
    // sistema inteiro nao protegia ninguem: com a API no chao ninguem emite
    // documento nenhum, nem os que funcionam — receita pela Memed inclusive.
    // O provedor que recusa preserva a garantia real (nada sai assinado sem
    // PSC) sem derrubar o que nao depende dele.
    signature: createUncontractedSignatureProvider(),
    /**
     * Ainda nao ha adaptador real de PSP nem de WhatsApp, mas o segredo do
     * webhook NAO pode continuar sendo o default do fake.
     *
     * `POST /v1/payments/webhook` e `POST /v1/messaging/webhook/:channel` sao
     * registradas sem sessao: o HMAC e a unica barreira. Com o default embutido
     * (`fake-payment-secret`, `fake-whatsapp-secret`), qualquer pessoa que leia
     * este repositorio assina um evento valido e marca lancamento como pago, em
     * qualquer tenant. Exigindo do ambiente, um deploy sem o segredo configurado
     * nao sobe — que e o desfecho certo — e o fake vira um PSP de verdade do
     * ponto de vista de quem tenta forjar entrada.
     */
    messaging: createFakeMessagingProvider({ appSecret: exigir('WHATSAPP_APP_SECRET') }),
    payment: createFakePaymentProvider({ webhookSecret: exigir('PSP_WEBHOOK_SECRET') }),
    transcription: transcricaoConfigurada(),
  };
  cache = reais;
  return reais;
}
