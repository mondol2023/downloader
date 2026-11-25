export {
  getDbHealth,
  onDbHealthChange,
  startDbHealthProbe,
  withConnectTimeout,
  type DbHealth,
} from './db-health.js';
export { requireDatabase } from './degraded.js';
export {
  drainOutbox,
  recordLedger,
  startOutboxDrainer,
  type OutboxKind,
  type OutboxRecord,
} from './outbox.js';
