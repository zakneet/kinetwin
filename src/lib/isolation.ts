/**
 * Finger isolation (individuation) estimate for the guided "move one finger"
 * test. Compares the movement amplitude of the target finger with the
 * simultaneous movement of the other long fingers.
 *
 * independence = 1 − mean(other amplitudes) / target amplitude, clamped to [0,1]
 * This is an application-defined indicator, not a clinical individuation index.
 */
import { LONG_FINGERS, type FingerName, type LongFingerName } from './landmarks';
import { computeRange } from './stats';

export interface IsolationResult {
  target: FingerName;
  valid: boolean;
  reason?: string;
  /** Robust (5–95 %) amplitude of each finger's total flexion, degrees. */
  amplitudes: Record<FingerName, number | null>;
  targetAmplitude: number | null;
  othersMean: number | null;
  othersMax: number | null;
  /** Mean unwanted movement as a fraction of the target movement. */
  unwantedRatio: number | null;
  independence: number | null;
  /** Finger that moved most among the non-target fingers. */
  mostCoupled: FingerName | null;
}

export const MIN_TARGET_AMPLITUDE_DEG = 20;

export function fingerIsolation(
  series: Partial<Record<FingerName, ReadonlyArray<number | null>>>,
  target: FingerName,
  minTargetAmplitude = MIN_TARGET_AMPLITUDE_DEG,
): IsolationResult {
  const amplitudes: Record<FingerName, number | null> = { thumb: null, index: null, middle: null, ring: null, little: null };
  for (const f of Object.keys(series) as FingerName[]) {
    const r = computeRange(series[f] ?? [], 5);
    amplitudes[f] = r ? r.robustAmplitude : null;
  }
  const base: IsolationResult = {
    target,
    valid: false,
    amplitudes,
    targetAmplitude: amplitudes[target],
    othersMean: null,
    othersMax: null,
    unwantedRatio: null,
    independence: null,
    mostCoupled: null,
  };
  const targetAmp = amplitudes[target];
  if (targetAmp === null) return { ...base, reason: 'Target finger was not tracked' };

  // Compare against the other long fingers (the thumb is excluded unless it is the target's neighbour set).
  const others = (LONG_FINGERS as readonly LongFingerName[]).filter((f) => f !== target);
  const otherAmps: { f: FingerName; a: number }[] = [];
  for (const f of others) {
    const a = amplitudes[f];
    if (a !== null) otherAmps.push({ f, a });
  }
  if (otherAmps.length === 0) return { ...base, reason: 'Other fingers were not tracked' };
  const othersMean = otherAmps.reduce((s, o) => s + o.a, 0) / otherAmps.length;
  const top = otherAmps.reduce((m, o) => (o.a > m.a ? o : m), otherAmps[0]);
  const res: IsolationResult = { ...base, othersMean, othersMax: top.a, mostCoupled: top.f };
  if (targetAmp < minTargetAmplitude) {
    return { ...res, reason: `Target finger moved ${targetAmp.toFixed(0)}°, below the ${minTargetAmplitude}° needed for a valid estimate` };
  }
  const unwantedRatio = othersMean / targetAmp;
  return {
    ...res,
    valid: true,
    unwantedRatio,
    independence: Math.max(0, Math.min(1, 1 - unwantedRatio)),
  };
}
