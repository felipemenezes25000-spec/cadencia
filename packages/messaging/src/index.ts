// packages/messaging/src/index.ts
export {
  resolveConversation,
  sendMessage,
  receiveInbound,
  type ResolveConversationInput, type ResolvedConversation,
  type SendMessageInput,
  type ReceiveInboundInput, type ReceivedInbound,
  type MessagingFailure,
} from './messaging';

export {
  computeReminderInstant,
} from './automations/reminder-timing';

export {
  handleAppointmentCreated,
  type AppointmentCreatedPayload,
  type AutomationRule,
  type AutomationTrigger,
  type ConfirmationOutboxEntry,
} from './automations/confirmation';

export {
  scheduleReminders,
  type ReminderOutboxEntry,
} from './automations/reminder';

export {
  handleEncounterFinalized,
  scheduleNps,
  type EncounterFinalizedPayload,
  type PostEncounterOutboxEntry,
  type NpsOutboxEntry,
} from './automations/post-encounter';
