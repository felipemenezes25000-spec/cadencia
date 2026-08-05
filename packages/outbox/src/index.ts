export { enqueue, type EnqueueInput } from './enqueue';
export {
  createDispatcher,
  type Dispatcher,
  type DispatcherDeps,
  type DispatchResult,
  type OutboxHandler,
  type OutboxRow,
} from './dispatcher';
export { fetchPending, markDispatched, markFailed } from './outbox-worker';
// Reexporta EventType para conveniencia de quem consome outbox + events junto.
// Permitido: outbox (serv-L0) importa events (base-L0).
export { type EventType } from '@cadencia/events';
