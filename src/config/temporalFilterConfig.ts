export const temporalFilterConfig = {
  // Alpha controls the smoothing factor for the EMA.
  // Lower values = more smoothing (more persistence, less reactive).
  // Higher values = less smoothing (more reactive, less persistence).
  alpha: 0.25,

  // Beta is reserved for future extensions (e.g., trend tracking in alpha-beta filters),
  // but currently kept at 0.0 to maintain strict deterministic EMA.
  beta: 0.0,

  // The safety floor below which even a heavily smoothed signal will drop to NO_TRADE.
  // The primary confidence gate is defined dynamically by the user's minConfidence setting.
  confidenceFloor: 20,
};
