export {
  registerProduct,
  type RegisterProductInput,
  type RegisteredProduct,
  type ProductFailure,
} from './register-product';
export {
  recordMovement,
  adjustStock,
  type RecordMovementInput,
  type RecordedMovement,
  type AdjustStockInput,
  type MovementFailure,
  type MovementKind,
  type ReferenceType,
} from './record-movement';
export {
  getStockAlerts,
  getMovementHistory,
  type StockAlert,
  type MovementHistoryRow,
  type MovementHistoryInput,
} from './queries';
