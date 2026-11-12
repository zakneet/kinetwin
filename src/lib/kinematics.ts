/**
 * Movement speed, duration, consistency and smoothness estimates.
 *
 * Every function first checks that the sampling is good enough; when it is
 * not, it returns null (with a reason where useful) instead of a number.
 * Webcam landmark jitter is NOT tremor: these indicators describe the
 * recorded landmark signal only and must not be read as neurological signs.
 */
import { finiteValues, mean, std } from './stats';

export interface SamplingCheck {
  ok: boolean;
  /** Median sampling rate (Hz), null if < 2 samples. */
  rateHz: number | null;
  /** Largest gap between consecutive samples (ms). */
  maxGapMs: number | null;
  reason?: string;
}

export const MIN_RATE_HZ = 15;
export const MAX_GAP_MS = 200;

export function checkSampling(times: ReadonlyArray<number>, minRateHz = MIN_RATE_HZ, maxGapMs = MAX_GAP_MS, minSamples = 10): SamplingCheck {
  if (times.length < 2) return { ok: false, rateHz: null, maxGapMs: null, reason: 'Not enough samples' };
  const dts: number[] = [];
  let maxGap = 0;
  for (let i = 1; i < times.length; i++) {
    const dt = times[i] - times[i - 1];
    if (!(dt > 0) || !Number.isFinite(dt)) continue;
    dts.push(dt);
    if (dt > maxGap) maxGap = dt;
  }
  if (dts.length === 0) return { ok: false, rateHz: null, maxGapMs: null, reason: 'Timestamps do not increase' };
  dts.sort((a, b) => a - b);
  const med = dts[Math.floor(dts.length / 2)];
  const rateHz = 1000 / med;
  if (times.length < minSamples) return { ok: false, rateHz, maxGapMs: maxGap, reason: `Need at least ${minSamples} samples` };
  if (rateHz < minRateHz) return { ok: false, rateHz, maxGapMs: maxGap, reason: `Sampling rate ${rateHz.toFixed(1)} Hz is below ${minRateHz} Hz` };
  if (maxGap > maxGapMs) return { ok: false, rateHz, maxGapMs: maxGap, reason: `Tracking gap of ${Math.round(maxGap)} ms` };
  return { ok: true, rateHz, maxGapMs: maxGap };
}

/**
 * Angular velocity (units/s) by central differences. Entries are null at the
 * ends, where a neighbour is missing, or across gaps longer than maxGapMs.
 */
export function angularVelocity(times: ReadonlyArray<number>, values: ReadonlyArray<number | null>, maxGapMs = MAX_GAP_MS): (number | null)[] {
  const n = Math.min(times.length, values.length);
  const out: (number | null)[] = new Array(n).fill(null);
  for (let i = 1; i < n - 1; i++) {
    const a = values[i - 1];
    const b = values[i + 1];
    const c = values[i];
    const dt = times[i + 1] - times[i - 1];
    // No value is reported at an instant where the hand itself was not tracked.
    if (a === null || b === null || c === null || !Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) continue;
    if (!(dt > 0) || times[i] - times[i - 1] > maxGapMs || times[i + 1] - times[i] > maxGapMs) continue;
    out[i] = ((b - a) / dt) * 1000;
  }
  return out;
}

/** Linear resampling onto a uniform grid. Returns null if fewer than 2 valid points. */
export function resampleUniform(times: ReadonlyArray<number>, values: ReadonlyArray<number | null>, hz: number): { t: number[]; v: number[] } | null {
  const pts: { t: number; v: number }[] = [];
  for (let i = 0; i < Math.min(times.length, values.length); i++) {
    const v = values[i];
    if (v !== null && Number.isFinite(v) && Number.isFinite(times[i])) pts.push({ t: times[i], v });
  }
  if (pts.length < 2 || !(hz > 0)) return null;
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const step = 1000 / hz;
  const outT: number[] = [];
  const outV: number[] = [];
  let j = 0;
  for (let t = t0; t <= t1 + 1e-9; t += step) {
    while (j < pts.length - 2 && pts[j + 1].t < t) j++;
    const a = pts[j];
    const b = pts[j + 1];
    const span = b.t - a.t;
    const k = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0;
    outT.push(t);
    outV.push(a.v + (b.v - a.v) * k);
  }
  return { t: outT, v: outV };
}

function movingAverage(v: number[], w: number): number[] {
  if (w <= 1) return v.slice();
  const half = Math.floor(w / 2);
  const out = new Array(v.length);
  for (let i = 0; i < v.length; i++) {
    let s = 0;
    let n = 0;
    for (let k = i - half; k <= i + half; k++) {
      if (k >= 0 && k < v.length) {
        s += v[k];
        n++;
      }
    }
    out[i] = s / n;
  }
  return out;
}

export interface MovementSummary {
  /** Time between the first and last sample where |velocity| exceeds 10 % of its peak (s). */
  durationSec: number;
  peakVelocity: number;
  meanAbsVelocity: number;
  /** Log dimensionless jerk (negative number; closer to 0 = smoother). */
  ldlj: number | null;
  /** Number of local speed peaks above 20 % of the peak (fewer = smoother). */
  speedPeaks: number;
}

/**
 * Estimated smoothness and speed of a 1D movement signal (e.g. finger flexion
 * sum or the openness index). Uses log dimensionless jerk (LDLJ; Balasubramanian
 * et al., 2015) on a 30 Hz resampled, lightly low-passed signal.
 * Returns null when sampling is insufficient — no estimate is better than a fake one.
 */
export function summarizeMovement(times: ReadonlyArray<number>, values: ReadonlyArray<number | null>): { ok: true; summary: MovementSummary } | { ok: false; reason: string } {
  const validTimes: number[] = [];
  for (let i = 0; i < Math.min(times.length, values.length); i++) {
    const v = values[i];
    if (v !== null && Number.isFinite(v)) validTimes.push(times[i]);
  }
  const chk = checkSampling(validTimes);
  if (!chk.ok) return { ok: false, reason: chk.reason ?? 'Insufficient sampling' };

  const hz = 30;
  const rs = resampleUniform(times, values, hz);
  if (!rs || rs.v.length < 8) return { ok: false, reason: 'Movement too short' };
  const x = movingAverage(rs.v, 3);
  const dt = 1 / hz;
  const vel: number[] = [];
  for (let i = 1; i < x.length - 1; i++) vel.push((x[i + 1] - x[i - 1]) / (2 * dt));
  const speed = vel.map(Math.abs);
  const peak = Math.max(...speed);
  if (!(peak > 1e-6)) return { ok: false, reason: 'No movement detected' };
  const thr = 0.1 * peak;
  let first = -1;
  let last = -1;
  for (let i = 0; i < speed.length; i++) {
    if (speed[i] > thr) {
      if (first < 0) first = i;
      last = i;
    }
  }
  const durationSec = first >= 0 ? (last - first + 1) * dt : 0;

  let speedPeaks = 0;
  for (let i = 1; i < speed.length - 1; i++) {
    if (speed[i] > speed[i - 1] && speed[i] >= speed[i + 1] && speed[i] > 0.2 * peak) speedPeaks++;
  }

  let ldlj: number | null = null;
  if (first >= 0 && last - first >= 4) {
    const seg = vel.slice(first, last + 1);
    const acc: number[] = [];
    for (let i = 1; i < seg.length; i++) acc.push((seg[i] - seg[i - 1]) / dt);
    const jerk: number[] = [];
    for (let i = 1; i < acc.length; i++) jerk.push((acc[i] - acc[i - 1]) / dt);
    const D = seg.length * dt;
    let integral = 0;
    for (const j of jerk) integral += j * j * dt;
    const vPeak = Math.max(...seg.map(Math.abs));
    if (integral > 0 && vPeak > 0) {
      const dlj = (Math.pow(D, 3) / (vPeak * vPeak)) * integral;
      const v = -Math.log(dlj);
      ldlj = Number.isFinite(v) ? v : null;
    }
  }

  return {
    ok: true,
    summary: {
      durationSec,
      peakVelocity: peak,
      meanAbsVelocity: mean(speed) ?? 0,
      ldlj,
      speedPeaks,
    },
  };
}

/**
 * Consistency of repeated measurements: 1 − coefficient of variation, clamped
 * to [0, 1]. Null for fewer than 2 values or a zero mean.
 */
export function consistency(values: ReadonlyArray<number | null>): number | null {
  const v = finiteValues(values);
  if (v.length < 2) return null;
  const m = mean(v);
  const s = std(v);
  if (m === null || s === null || Math.abs(m) < 1e-9) return null;
  return Math.max(0, Math.min(1, 1 - s / Math.abs(m)));
}

export interface Cycle {
  startT: number;
  closedT: number;
  endT: number;
  durationMs: number;
  minValue: number;
  maxValue: number;
  amplitude: number;
}

/**
 * Detects open→closed→open cycles in an openness-like signal using hysteresis
 * thresholds (high = "open", low = "closed"). Gaps longer than maxGapMs reset
 * the state machine so a lost hand is never counted as a movement.
 */
export function detectCycles(times: ReadonlyArray<number>, values: ReadonlyArray<number | null>, low: number, high: number, maxGapMs = 400): Cycle[] {
  const cycles: Cycle[] = [];
  type State = 'unknown' | 'open' | 'closing' | 'closed';
  let state: State = 'unknown';
  let startT = 0;
  let closedT = 0;
  let minV = Infinity;
  let maxV = -Infinity;
  let lastT: number | null = null;
  for (let i = 0; i < Math.min(times.length, values.length); i++) {
    const v = values[i];
    const t = times[i];
    if (v === null || !Number.isFinite(v)) continue;
    if (lastT !== null && t - lastT > maxGapMs) state = 'unknown';
    lastT = t;
    switch (state) {
      case 'unknown':
        if (v >= high) {
          state = 'open';
          startT = t;
          minV = v;
          maxV = v;
        }
        break;
      case 'open':
        if (v >= high) {
          startT = t; // still open: the cycle starts at the last fully-open sample
          minV = v;
          maxV = Math.max(v, maxV);
        } else {
          state = 'closing';
          minV = Math.min(minV, v);
        }
        break;
      case 'closing':
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);
        if (v <= low) {
          state = 'closed';
          closedT = t;
        } else if (v >= high) {
          state = 'open';
          startT = t;
          minV = v;
          maxV = v;
        }
        break;
      case 'closed':
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);
        if (v >= high) {
          cycles.push({ startT, closedT, endT: t, durationMs: t - startT, minValue: minV, maxValue: maxV, amplitude: maxV - minV });
          state = 'open';
          startT = t;
          minV = v;
          maxV = v;
        }
        break;
    }
  }
  return cycles;
}
