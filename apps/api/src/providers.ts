import {
  createUncontractedSignatureProvider,
  createFakeTranscriptionProvider, createOpenAiTranscriptionProvider,
  type TranscriptionProvider,
  createFakePrescriptionProvider, createFakeSignatureProvider,
  createFakeMessagingProvider, createFakePaymentProvider,
  createFakeEmailProvider, createSmtpEmailProvider,
  createFakeTeleconsultProvider, createJitsiTeleconsultProvider,
  createMemedProvider,
  type PrescriptionProvider, type SignatureProvider,
  type MessagingProvider, type PaymentProvider,
  type EmailProvider, type TeleconsultProvider,
} from '@cadencia/integrations';

export interface Providers {
  readonly signature: SignatureProvider;
  readonly prescription: PrescriptionProvider;
  readonly messaging: MessagingProvider;
  readonly payment: PaymentProvider;
  readonly transcription: TranscriptionProvider;
  readonly email: EmailProvider;
  readonly teleconsult: TeleconsultProvider;
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
 * A troca fake→real é por variável de ambiente e vale para o processo inteiro.
 *
 * Não existe modo misto por engano: `real` exige TODOS os adaptadores reais
 * disponíveis e falha alto no boot se faltar credencial. Um sistema que sobe
 * com prescrição real e assinatura fake emite receita que não vale nada — e o
 * médico só descobre quando a farmácia recusa.
 */
/**
 * OpenAI quando há chave; fake quando não há.
 *
 * Não lança sem a chave, ao contrário dos outros: transcrição é ASSISTÊNCIA. A
 * clínica que não contratou continua atendendo — só não ganha o rascunho pronto.
 * Derrubar o boot por causa disso trocaria uma comodidade ausente por um sistema
 * fora do ar.
 */
function transcricaoConfigurada(): TranscriptionProvider {
  const chave = process.env['OPENAI_API_KEY'];
  if (chave === undefined || chave === '') return createFakeTranscriptionProvider();
  return createOpenAiTranscriptionProvider({ apiKey: chave });
}

/**
 * SMTP quando ha host configurado; fake quando nao ha.
 *
 * Mesmo raciocinio da transcricao: email e ASSISTENCIA. A clinica que nao
 * configurou SMTP continua operando — so nao envia email transacional.
 * Derrubar o boot porque falta credencial de email trocaria uma notificacao
 * ausente por um sistema fora do ar.
 */
function emailConfigurado(): EmailProvider {
  const host = process.env['SMTP_HOST'];
  if (host === undefined || host === '') return createFakeEmailProvider();
  return createSmtpEmailProvider({
    host,
    port: Number(process.env['SMTP_PORT'] ?? '587'),
    user: exigir('SMTP_USER'),
    pass: exigir('SMTP_PASS'),
    from: exigir('SMTP_FROM'),
  });
}

export function providers(): Providers {
  if (cache !== null) return cache;

  const modo = process.env['CADENCIA_PROVIDERS'];

  /**
   * Modo intermediário: Memed real, o resto fake.
   *
   * `real` é tudo-ou-nada e trava no boot enquanto não existir adaptador
   * ICP-Brasil — o que significa que a Memed nunca poderia ser ligada. A trava
   * estava protegendo o documento errado: para RECEITA, a própria Memed é a
   * camada de assinatura qualificada; o adaptador ICP-Brasil que falta é para
   * ATESTADO e demais documentos.
   *
   * A assinatura NÃO vira fake: vira o provedor que RECUSA. O fake assina com
   * sucesso e reporta `valida`, o que gravaria atestado com estado `assinado` e
   * sem valor legal — indistinguível de ICP-Brasil real no banco. Recusando, o
   * documento é emitido e fica explicitamente PENDENTE de assinatura.
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
      email: emailConfigurado(),
      teleconsult: createJitsiTeleconsultProvider(),
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
      email: createFakeEmailProvider(),
      teleconsult: createFakeTeleconsultProvider(),
    };
    cache = comFakes;
    return comFakes;
  }

  const reais: Providers = {
    prescription: createMemedProvider({
      // A base já inclui /v1. Homologação e produção são hosts diferentes, e a
      // diferença entre eles é "receita de teste" contra "receita que a farmácia
      // dispensa": nunca deduzir, sempre configurar.
      baseUrl: exigir('MEMED_BASE_URL'),
      scriptUrl: exigir('MEMED_SCRIPT_URL'),
      apiKey: exigir('MEMED_API_KEY'),
      secretKey: exigir('MEMED_SECRET_KEY'),
    }),
    // Ainda sem adaptador de PSC. Antes isto LANÇAVA no boot, e travar o
    // sistema inteiro não protegia ninguém: com a API no chão ninguém emite
    // documento nenhum, nem os que funcionam — receita pela Memed inclusive.
    // O provedor que recusa preserva a garantia real (nada sai assinado sem
    // PSC) sem derrubar o que não depende dele.
    signature: createUncontractedSignatureProvider(),
    /**
     * Ainda não há adaptador real de PSP nem de WhatsApp, mas o segredo do
     * webhook NÃO pode continuar sendo o default do fake.
     *
     * `POST /v1/payments/webhook` e `POST /v1/messaging/webhook/:channel` são
     * registradas sem sessão: o HMAC é a única barreira. Com o default embutido
     * (`fake-payment-secret`, `fake-whatsapp-secret`), qualquer pessoa que leia
     * este repositório assina um evento válido e marca lançamento como pago, em
     * qualquer tenant. Exigindo do ambiente, um deploy sem o segredo configurado
     * não sobe — que é o desfecho certo — e o fake vira um PSP de verdade do
     * ponto de vista de quem tenta forjar entrada.
     */
    messaging: createFakeMessagingProvider({ appSecret: exigir('WHATSAPP_APP_SECRET') }),
    payment: createFakePaymentProvider({ webhookSecret: exigir('PSP_WEBHOOK_SECRET') }),
    transcription: transcricaoConfigurada(),
    email: emailConfigurado(),
    teleconsult: createJitsiTeleconsultProvider(),
  };
  cache = reais;
  return reais;
}
