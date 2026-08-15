import {
  createAsaasPaymentProvider,
  createFakeCalendarProvider,
  createFakeEmailProvider,
  createFakeMessagingProvider,
  createFakePaymentProvider,
  createFakeSmsProvider,
  createGoogleCalendarProvider,
  createSmtpEmailProvider,
  createTwilioSmsProvider,
  createWhatsAppCloudProvider,
  type CalendarProvider,
  type EmailProvider,
  type MessagingProvider,
  type PaymentProvider,
} from '@cadencia/integrations';

export interface WorkerProviders {
  readonly messaging: MessagingProvider;
  readonly sms: MessagingProvider;
  readonly payment: PaymentProvider;
  readonly email: EmailProvider;
  readonly calendar: CalendarProvider;
}

function exigir(nome: string): string {
  const valor = process.env[nome];
  if (valor === undefined || valor === '') {
    throw new Error(`${nome} ausente — obrigatoria com CADENCIA_PROVIDERS=real`);
  }
  return valor;
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

/**
 * Registry do processo assíncrono.
 *
 * `real` precisa usar os mesmos adapters operacionais da API. O worker é quem
 * executa os efeitos externos; deixar qualquer integração real de fora daqui
 * faz a borda HTTP prometer uma funcionalidade que nunca sai da fila.
 */
export function workerProviders(): WorkerProviders {
  const modo = process.env['CADENCIA_PROVIDERS'];

  if (modo === 'real') {
    return {
      messaging: createWhatsAppCloudProvider({
        accessToken: exigir('WHATSAPP_ACCESS_TOKEN'),
        phoneNumberId: exigir('WHATSAPP_PHONE_NUMBER_ID'),
        appSecret: exigir('WHATSAPP_APP_SECRET'),
      }),
      sms: createTwilioSmsProvider({
        accountSid: exigir('TWILIO_ACCOUNT_SID'),
        authToken: exigir('TWILIO_AUTH_TOKEN'),
        fromNumber: exigir('TWILIO_FROM_NUMBER'),
      }),
      payment: createAsaasPaymentProvider({
        apiKey: exigir('ASAAS_API_KEY'),
        webhookToken: exigir('ASAAS_WEBHOOK_TOKEN'),
      }),
      email: emailConfigurado(),
      calendar: createGoogleCalendarProvider(),
    };
  }

  if (modo === 'memed') {
    return {
      messaging: createFakeMessagingProvider({ appSecret: exigir('WHATSAPP_APP_SECRET') }),
      sms: createFakeSmsProvider(),
      payment: createFakePaymentProvider({ webhookSecret: exigir('PSP_WEBHOOK_SECRET') }),
      email: emailConfigurado(),
      calendar: createFakeCalendarProvider(),
    };
  }

  return {
    messaging: createFakeMessagingProvider(),
    sms: createFakeSmsProvider(),
    payment: createFakePaymentProvider(),
    email: createFakeEmailProvider(),
    calendar: createFakeCalendarProvider(),
  };
}
