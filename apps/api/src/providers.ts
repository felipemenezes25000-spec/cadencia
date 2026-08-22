import {
  createUncontractedSignatureProvider,
  createFakeTranscriptionProvider, createOpenAiTranscriptionProvider,
  type TranscriptionProvider,
  createFakePrescriptionProvider, createFakeSignatureProvider,
  createFakeMessagingProvider,
  createFakeEmailProvider, createSmtpEmailProvider,
  createFakeTeleconsultProvider, createJitsiTeleconsultProvider,
  createFakeCalendarProvider,
  createMemedProvider,
  createFakeSmsProvider,
  createWhatsAppCloudProvider,
  createTwilioSmsProvider,
  createGoogleCalendarProvider,
  createBirdIdSignatureProvider,
  type PrescriptionProvider, type SignatureProvider,
  type MessagingProvider,
  type EmailProvider, type TeleconsultProvider, type CalendarProvider,
} from '@cadencia/integrations';

export interface Providers {
  readonly signature: SignatureProvider;
  readonly prescription: PrescriptionProvider;
  readonly messaging: MessagingProvider;
  readonly sms: MessagingProvider;
  readonly transcription: TranscriptionProvider;
  readonly email: EmailProvider;
  readonly teleconsult: TeleconsultProvider;
  readonly calendar: CalendarProvider;
}

let cache: Providers | null = null;

function exigir(nome: string): string {
  const v = process.env[nome];
  if (v === undefined || v === '') throw new Error(`${nome} ausente — obrigatoria com CADENCIA_PROVIDERS=real`);
  return v;
}

function transcricaoConfigurada(): TranscriptionProvider {
  const chave = process.env['OPENAI_API_KEY'];
  if (chave === undefined || chave === '') return createFakeTranscriptionProvider();
  return createOpenAiTranscriptionProvider({ apiKey: chave });
}

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

  if (modo === 'memed') {
    const soMemed: Providers = {
      prescription: createMemedProvider({
        baseUrl: exigir('MEMED_BASE_URL'), scriptUrl: exigir('MEMED_SCRIPT_URL'),
        apiKey: exigir('MEMED_API_KEY'), secretKey: exigir('MEMED_SECRET_KEY'),
      }),
      signature: createUncontractedSignatureProvider(),
      messaging: createFakeMessagingProvider({ appSecret: exigir('WHATSAPP_APP_SECRET') }),
      sms: createFakeSmsProvider(),
      transcription: transcricaoConfigurada(),
      email: emailConfigurado(),
      teleconsult: createJitsiTeleconsultProvider(),
      calendar: createFakeCalendarProvider(),
    };
    cache = soMemed;
    return soMemed;
  }

  if (modo !== 'real') {
    const comFakes: Providers = {
      signature: createFakeSignatureProvider(),
      prescription: createFakePrescriptionProvider(),
      messaging: createFakeMessagingProvider(),
      sms: createFakeSmsProvider(),
      transcription: createFakeTranscriptionProvider(),
      email: createFakeEmailProvider(),
      teleconsult: createFakeTeleconsultProvider(),
      calendar: createFakeCalendarProvider(),
    };
    cache = comFakes;
    return comFakes;
  }

  const reais: Providers = {
    prescription: createMemedProvider({
      baseUrl: exigir('MEMED_BASE_URL'), scriptUrl: exigir('MEMED_SCRIPT_URL'),
      apiKey: exigir('MEMED_API_KEY'), secretKey: exigir('MEMED_SECRET_KEY'),
    }),
    signature: createBirdIdSignatureProvider({ clientId: exigir('BIRDID_CLIENT_ID'), clientSecret: exigir('BIRDID_CLIENT_SECRET') }),
    messaging: createWhatsAppCloudProvider({
      accessToken: exigir('WHATSAPP_ACCESS_TOKEN'), phoneNumberId: exigir('WHATSAPP_PHONE_NUMBER_ID'),
      appSecret: exigir('WHATSAPP_APP_SECRET'),
    }),
    sms: createTwilioSmsProvider({
      accountSid: exigir('TWILIO_ACCOUNT_SID'), authToken: exigir('TWILIO_AUTH_TOKEN'), fromNumber: exigir('TWILIO_FROM_NUMBER'),
    }),
    transcription: transcricaoConfigurada(),
    email: emailConfigurado(),
    teleconsult: createJitsiTeleconsultProvider(),
    calendar: createGoogleCalendarProvider(),
  };
  cache = reais;
  return reais;
}
