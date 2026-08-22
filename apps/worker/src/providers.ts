import {
  createFakeCalendarProvider,
  createFakeEmailProvider,
  createFakeMessagingProvider,
  createFakeSmsProvider,
  createGoogleCalendarProvider,
  createSmtpEmailProvider,
  createTwilioSmsProvider,
  createWhatsAppCloudProvider,
  type CalendarProvider,
  type EmailProvider,
  type MessagingProvider,
} from '@cadencia/integrations';

export interface WorkerProviders {
  readonly messaging: MessagingProvider;
  readonly sms: MessagingProvider;
  readonly email: EmailProvider;
  readonly calendar: CalendarProvider;
}

function exigir(nome: string): string {
  const valor = process.env[nome];
  if (valor === undefined || valor === '') throw new Error(`${nome} ausente — obrigatoria com CADENCIA_PROVIDERS=real`);
  return valor;
}

function emailConfigurado(): EmailProvider {
  const host = process.env['SMTP_HOST'];
  if (host === undefined || host === '') return createFakeEmailProvider();
  return createSmtpEmailProvider({
    host,
    port: Number(process.env['SMTP_PORT'] ?? '587'),
    user: exigir('SMTP_USER'), pass: exigir('SMTP_PASS'), from: exigir('SMTP_FROM'),
  });
}

export function workerProviders(): WorkerProviders {
  const modo = process.env['CADENCIA_PROVIDERS'];
  if (modo === 'real') {
    return {
      messaging: createWhatsAppCloudProvider({
        accessToken: exigir('WHATSAPP_ACCESS_TOKEN'), phoneNumberId: exigir('WHATSAPP_PHONE_NUMBER_ID'), appSecret: exigir('WHATSAPP_APP_SECRET'),
      }),
      sms: createTwilioSmsProvider({
        accountSid: exigir('TWILIO_ACCOUNT_SID'), authToken: exigir('TWILIO_AUTH_TOKEN'), fromNumber: exigir('TWILIO_FROM_NUMBER'),
      }),
      email: emailConfigurado(),
      calendar: createGoogleCalendarProvider(),
    };
  }
  if (modo === 'memed') {
    return {
      messaging: createFakeMessagingProvider({ appSecret: exigir('WHATSAPP_APP_SECRET') }),
      sms: createFakeSmsProvider(), email: emailConfigurado(), calendar: createFakeCalendarProvider(),
    };
  }
  return {
    messaging: createFakeMessagingProvider(), sms: createFakeSmsProvider(),
    email: createFakeEmailProvider(), calendar: createFakeCalendarProvider(),
  };
}
