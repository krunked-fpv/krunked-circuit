import type { SimState } from '../contracts/index';

// ============================================================================
// Deterministic Mulberry32 PRNG (100% Pure, DOM-Free)
// All simulation randomness flows exclusively through SimState.rngState.
// ============================================================================

export function stepMulberry32(seed: number): { nextSeed: number; value: number } {
  const a = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { nextSeed: a >>> 0, value };
}

/**
 * Advances SimState.rngState via mulberry32 and returns a float in [0, 1).
 */
export function nextRng(state: SimState): number {
  const step = stepMulberry32(state.rngState);
  state.rngState = step.nextSeed;
  return step.value;
}

/**
 * Returns a deterministic floating-point number in [min, max).
 */
export function rngRange(state: SimState, min: number, max: number): number {
  if (max <= min) {
    return min;
  }
  return min + nextRng(state) * (max - min);
}

/**
 * Returns a deterministic integer in [min, max] (inclusive).
 */
export function rngInt(state: SimState, min: number, max: number): number {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  if (hi <= lo) {
    return lo;
  }
  return lo + Math.floor(nextRng(state) * (hi - lo + 1));
}
