/**
 * Result computation for the guided assessment tests. Inputs are the real
 * tracked samples collected during each test step; when tracking or movement
 * is insufficient the step is reported as invalid with the reason — results
 * are never filled in.
 */
import type { JointAngles } from './angles';
import type { FrameAnalysis } from './analysis';
import { fingerIsolation, type IsolationResult } from './isolation';
import { consistency, detectCycles, summarizeMovement, type Cycle, type MovementSummary } from './kinematics';
import { FINGERS, LONG_FINGERS, type FingerName, type LongFingerName } from './landmarks';
import { computeRange, type RangeSummary } from './stats';

export interface AssessmentSample {
  t: number;
  score: number;
  openness: number | null;
  flexion: Record<FingerName, number | null>;
  opposition: Record<LongFingerName, number | null>;
  spreadTotal: number | null;
  tipSpread: number | null;
  thumbIndex: number | null;
  angles: JointAngles;
}

export function toAssessmentSample(t: number, score: number, a: FrameAnalysis): AssessmentSample {
  return {
    t,
    score,
    openness: a.openness,
    flexion: { ...a.flexion },
    opposition: { ...a.opposition },
    spreadTotal: a.spread.totalLong,
    tipSpread: a.spread.tipSpreadRatio,
    thumbIndex: a.spread.thumbIndex,
    angles: { ...a.angles },
  };
}

/** Fraction of the step window during which the hand was actually tracked. */
export function trackingCoverage(samples: ReadonlyArray<{ t: number }>, windowMs: number, maxGapMs = 200): number {
  if (samples.length < 2 || !(windowMs > 0)) return 0;
  let tracked = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].t - samples[i - 1].t;
    if (dt > 0 && dt <= maxGapMs) tracked += dt;
  }
  return Math.max(0, Math.min(1, tracked / windowMs));
}

export const MIN_COVERAGE = 0.6;

export interface StepValidity {
  valid: boolean;
  coverage: number;
  reason?: string;
}

export function stepValidity(samples: ReadonlyArray<{ t: number }>, windowMs: number): StepValidity {
  const coverage = trackingCoverage(samples, windowMs);
  if (samples.length < 10) return { valid: false, coverage, reason: 'Hand was not tracked during this step' };
  if (coverage < MIN_COVERAGE) return { valid: false, coverage, reason: `Hand tracked for only ${Math.round(coverage * 100)} % of the step` };
  return { valid: true, coverage };
}

// ---------------- Test 1: open and close ----------------

export interface OpenCloseResult {
  kind: 'open-close';
  validity: StepValidity;
  reason?: string;
  opennessRange: RangeSummary | null;
  thresholds: { low: number; high: number } | null;
  cycles: Cycle[];
  meanCycleSec: number | null;
  durationConsistency: number | null;
  amplitudeConsistency: number | null;
  fingerFlexion: Record<FingerName, RangeSummary | null>;
  movement: MovementSummary | null;
  movementNote?: string;
}

export function computeOpenClose(samples: ReadonlyArray<AssessmentSample>, windowMs: number): OpenCloseResult {
  const validity = stepValidity(samples, windowMs);
  const fingerFlexion = {} as Record<FingerName, RangeSummary | null>;
  for (const f of FINGERS) fingerFlexion[f] = computeRange(samples.map((s) => s.flexion[f]), 5);
  const t = samples.map((s) => s.t);
  const o = samples.map((s) => s.openness);
  const opennessRange = computeRange(o, 5);
  const base: OpenCloseResult = {
    kind: 'open-close',
    validity,
    opennessRange,
    thresholds: null,
    cycles: [],
    meanCycleSec: null,
    durationConsistency: null,
    amplitudeConsistency: null,
    fingerFlexion,
    movement: null,
  };
  if (!validity.valid) return { ...base, reason: validity.reason };
  if (!opennessRange || opennessRange.robustAmplitude < 0.2) {
    return { ...base, reason: 'Openness changed too little to detect open/close movement' };
  }
  // Adaptive hysteresis: thresholds follow the person's own observed range.
  const lo = opennessRange.min + 0.3 * opennessRange.amplitude;
  const hi = opennessRange.max - 0.3 * opennessRange.amplitude;
  const cycles = detectCycles(t, o, lo, hi);
  const mv = summarizeMovement(t, o);
  const res: OpenCloseResult = {
    ...base,
    thresholds: { low: lo, high: hi },
    cycles,
    meanCycleSec: cycles.length ? cycles.reduce((s, c) => s + c.durationMs, 0) / cycles.length / 1000 : null,
    durationConsistency: consistency(cycles.map((c) => c.durationMs)),
    amplitudeConsistency: consistency(cycles.map((c) => c.amplitude)),
    movement: mv.ok ? mv.summary : null,
    movementNote: mv.ok ? undefined : mv.reason,
  };
  if (cycles.length === 0) res.reason = 'No complete open → close → open cycle was detected';
  return res;
}

// ---------------- Test 2: individual finger movement ----------------

export interface IsolationStepResult {
  target: FingerName;
  validity: StepValidity;
  isolation: IsolationResult | null;
}

export function computeIsolationStep(target: FingerName, samples: ReadonlyArray<AssessmentSample>, windowMs: number): IsolationStepResult {
  const validity = stepValidity(samples, windowMs);
  if (!validity.valid) return { target, validity, isolation: null };
  const series = {} as Record<FingerName, (number | null)[]>;
  for (const f of FINGERS) series[f] = samples.map((s) => s.flexion[f]);
  return { target, validity, isolation: fingerIsolation(series, target) };
}

// ---------------- Test 3: thumb opposition ----------------

export const CLOSE_APPROACH = 0.3; // × palm length, application-defined

export interface OppositionStepResult {
  target: LongFingerName;
  validity: StepValidity;
  minDistance: number | null;
  /** ms from step start to the closest approach. */
  timeToMinMs: number | null;
  closeApproach: boolean | null;
}

export function computeOppositionStep(target: LongFingerName, samples: ReadonlyArray<AssessmentSample>, windowMs: number): OppositionStepResult {
  const validity = stepValidity(samples, windowMs);
  if (!validity.valid || samples.length === 0) return { target, validity, minDistance: null, timeToMinMs: null, closeApproach: null };
  let min = Infinity;
  let tMin = 0;
  for (const s of samples) {
    const d = s.opposition[target];
    if (d !== null && Number.isFinite(d) && d < min) {
      min = d;
      tMin = s.t;
    }
  }
  if (!Number.isFinite(min)) return { target, validity: { ...validity, valid: false, reason: 'Distance could not be measured' }, minDistance: null, timeToMinMs: null, closeApproach: null };
  return { target, validity, minDistance: min, timeToMinMs: tMin - samples[0].t, closeApproach: min <= CLOSE_APPROACH };
}

// ---------------- Test 4: finger spreading ----------------

export interface SpreadResult {
  kind: 'finger-spread';
  validity: StepValidity;
  reason?: string;
  totalSpread: RangeSummary | null;
  tipSpread: RangeSummary | null;
  thumbIndex: RangeSummary | null;
  cycles: number;
}

export function computeSpread(samples: ReadonlyArray<AssessmentSample>, windowMs: number): SpreadResult {
  const validity = stepValidity(samples, windowMs);
  const totalSpread = computeRange(samples.map((s) => s.spreadTotal), 5);
  const tipSpread = computeRange(samples.map((s) => s.tipSpread), 5);
  const thumbIndex = computeRange(samples.map((s) => s.thumbIndex), 5);
  const base: SpreadResult = { kind: 'finger-spread', validity, totalSpread, tipSpread, thumbIndex, cycles: 0 };
  if (!validity.valid) return { ...base, reason: validity.reason };
  if (!totalSpread || totalSpread.robustAmplitude < 8) return { ...base, reason: 'Finger separation changed too little to measure spreading' };
  const lo = totalSpread.min + 0.3 * totalSpread.amplitude;
  const hi = totalSpread.max - 0.3 * totalSpread.amplitude;
  // Reuse cycle detection: "open" = spread apart.
  const cycles = detectCycles(samples.map((s) => s.t), samples.map((s) => s.spreadTotal), lo, hi);
  return { ...base, cycles: cycles.length };
}

export { LONG_FINGERS };
