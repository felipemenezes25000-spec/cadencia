export {
  asE164, asRfc3339, asStorageKey, failure, isRetryable, success,
  type E164, type Provider, type ProviderCtx, type ProviderFailure, type ProviderResult,
  type Rfc3339, type Safety, type StorageKey,
} from './contracts/common';
export {
  SIGNATURE_POLICIES, isSignaturePolicy,
  type CertificateInfo, type SignDocumentInput, type SignatureProvider,
  type SignaturePolicy, type SignedDocument, type VerifyResult,
} from './contracts/signature';
export {
  createFakeSignatureProvider, type FakeSignatureOptions, type ModoFake,
} from './fakes/signature-fake';
export {
  type PrescriberRef, type PrescriberSession, type PrescriptionDocument,
  type PrescriptionItem, type PrescriptionProvider, type PrescriptionRecord,
} from './contracts/prescription';
export {
  createMemedProvider, type MemedConfig, type MemedDeps,
} from './adapters/memed';
export {
  createFakePrescriptionProvider, type FakePrescriptionOptions,
} from './fakes/prescription-fake';
export {
  assertNoDuplicateOnTimeout, assertSafetyDeclared,
  type TimeoutOutcome, type TimeoutScenario,
} from './conformance';
export {
  type MessagingProvider, type OutboundBody, type InboundEvent,
  type InboundMessage, type InboundMessageBody, type StatusUpdate,
  type WebhookVerificationContext,
} from './contracts/messaging';
export {
  createFakeMessagingProvider, type FakeMessagingOptions, type ModoFakeMsg, type SentRecord,
} from './fakes/messaging-fake';
export {
  createFakeSmsProvider, type FakeSmsOptions,
} from './fakes/sms-fake';
export {
  PAYMENT_STATUSES, isPaymentStatus,
  type PaymentLinkInput, type PaymentLinkResult, type PaymentProvider,
  type PaymentSnapshot, type PaymentStatus, type Settlement,
} from './contracts/payment';
export { createUncontractedSignatureProvider } from './adapters/assinatura-nao-contratada';
export {
  createFakePaymentProvider, type FakePaymentOptions,
} from './fakes/payment-fake';
export type {
  TranscriptionProvider, TranscricaoBruta, SugestaoClinica, FalaTranscrita,
} from './contracts/transcription';
export { createFakeTranscriptionProvider } from './fakes/transcription-fake';
export { createOpenAiTranscriptionProvider,
  type OpenAiTranscricaoConfig } from './adapters/openai-transcricao';
export type { EmailProvider, EmailEnvelope } from './contracts/email';
export { createFakeEmailProvider, type FakeEmailOptions, type SentEmail } from './fakes/email-fake';
export { createSmtpEmailProvider, type SmtpEmailConfig } from './adapters/smtp-email';
export { conviteEquipeEmail, type ConviteEquipeVars } from './email-templates/convite-equipe';
export { lembreteConsultaEmail, type LembreteConsultaVars } from './email-templates/lembrete-consulta';
export type { TeleconsultProvider, CreateRoomInput, TeleconsultRoom } from './contracts/teleconsult';
export { createFakeTeleconsultProvider, type FakeTeleconsultOptions, type CreatedRoom as CreatedTeleconsultRoom } from './fakes/teleconsult-fake';
export { createJitsiTeleconsultProvider } from './adapters/jitsi-teleconsult';
export type { CalendarProvider, CalendarEvent, CalendarInfo } from './contracts/calendar';
export { createFakeCalendarProvider, type FakeCalendarOptions, type CreatedCalendarEvent } from './fakes/calendar-fake';
export { createAsaasPaymentProvider, type AsaasConfig } from './adapters/asaas-payment';
export { createWhatsAppCloudProvider, type WhatsAppCloudConfig } from './adapters/whatsapp-messaging';
export { createTwilioSmsProvider, type TwilioSmsConfig } from './adapters/twilio-sms';
export { createGoogleCalendarProvider, calendarEventIdFromIdempotencyKey } from './adapters/google-calendar';
export type {
  TissTransportProvider, TissGuiaConsulta, TissGuiaSadt, TissLote,
  TissSubmissaoResult,
} from './contracts/tiss-transport';
export { createTissSoapTransportProvider } from './adapters/tiss-soap-transport';
export { serializeLoteXml, wrapInSoapEnvelope } from './adapters/tiss-xml';
export { createBirdIdSignatureProvider, type BirdIdConfig } from './adapters/birdid-signature';
export { createFakeTissTransportProvider } from './fakes/tiss-transport-fake';
