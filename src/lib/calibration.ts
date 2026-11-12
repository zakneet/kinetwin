/**
 * Personal calibration: the user holds an open, neutral hand while a stable
 * run of frames is captured. The mean of each joint estimate becomes their
 * personal baseline. Later values are displayed relative to it.
 *
 * No population thresholds or normal/abnormal classes are used.
 */
import { JOINT_IDS, type JointAngles, type JointId } from './angles';
import type { Handedness } from './landmarks';
import type { FrameAnalysis } from './analysis';
import { mean, std } from './stats';

export interface CalibrationSample {
  t: number;
  handedness: Handedness;
  score: number;
  analysis: FrameAnalysis;
}

export interface Baseline {
  schema: 'kinetwin.baseline';
  version: 1;
  handedness: Handedness;
  createdAt: string;
  frameCount: number;
  durationMs: number;
  jointAngles: Record<JointId, number | null>;
  jointStd: Record<JointId, number | null>;
  palmLength: number | null;
  palmWidth: number | null;
  openness: number | null;
}

export interface CalibrationOptions {
  minFrames: number;
  /** Maximum allowed standard deviation of any joint estimate (deg) for the run to count as stable. */
  maxJointStdDeg: number;
  minScore: number;
  /** Required openness: the neutral pose is an open hand. */
  minOpenness: number;
}

export const DEFAULT_CALIBRATION: CalibrationOptions = {
  minFrames: 30,
  maxJointStdDeg: 5,
  minScore: 0.6,
  minOpenness: 0.55,
};

export type CalibrationResult = { ok: true; baseline: Baseline } | { ok: false; reason: string };

export function computeBaseline(samples: ReadonlyArray<CalibrationSample>, opts: CalibrationOptions = DEFAULT_CALIBRATION, now = new Date()): CalibrationResult {
  const good = samples.filter((s) => s.score >= opts.minScore);
  if (good.length < opts.minFrames) {
    return { ok: false, reason: `Only ${good.length} confident frames captured; ${opts.minFrames} needed. Keep the hand inside the camera view.` };
  }
  const hands = new Set(good.map((s) => s.handedness));
  if (hands.size > 1) return { ok: false, reason: 'Handedness changed during calibration. Keep one hand in view.' };
  const handedness = good[0].handedness;

  const jointAngles = {} as Record<JointId, number | null>;
  const jointStd = {} as Record<JointId, number | null>;
  let worstStd = 0;
  let worstJoint: JointId | null = null;
  let measured = 0;
  for (const id of JOINT_IDS) {
    const series = good.map((s) => s.analysis.angles[id]);
    const m = mean(series);
    const sd = std(series);
    jointAngles[id] = m;
    jointStd[id] = sd;
    if (m !== null) measured++;
    if (sd !== null && sd > worstStd) {
      worstStd = sd;
      worstJoint = id;
    }
  }
  if (measured < JOINT_IDS.length - 2) return { ok: false, reason: 'Too many joints could not be estimated. Show the whole hand to the camera.' };
  if (worstStd > opts.maxJointStdDeg) {
    return { ok: false, reason: `Hand was not steady (${worstJoint?.replace('_', ' ')} varied by ±${worstStd.toFixed(1)}°). Hold still and retry.` };
  }
  const openness = mean(good.map((s) => s.analysis.openness));
  if (openness === null || openness < opts.minOpenness) {
    return { ok: false, reason: 'The hand does not look open. Spread your hand flat, palm toward the camera, and retry.' };
  }
  return {
    ok: true,
    baseline: {
      schema: 'kinetwin.baseline',
      version: 1,
      handedness,
      createdAt: now.toISOString(),
      frameCount: good.length,
      durationMs: good[good.length - 1].t - good[0].t,
      jointAngles,
      jointStd,
      palmLength: mean(good.map((s) => s.analysis.dims?.palmLength ?? null)),
      palmWidth: mean(good.map((s) => s.analysis.dims?.palmWidth ?? null)),
      openness,
    },
  };
}

/** Current angle minus the personal baseline, per joint (null where either is missing). */
export function deltaFromBaseline(angles: JointAngles, baseline: Baseline | null): Record<JointId, number | null> {
  const out = {} as Record<JointId, number | null>;
  for (const id of JOINT_IDS) {
    const a = angles[id];
    const b = baseline?.jointAngles[id] ?? null;
    out[id] = a === null || b === null ? null : a - b;
  }
  return out;
}

export function isBaseline(x: unknown): x is Baseline {
  if (!x || typeof x !== 'object') return false;
  const b = x as Partial<Baseline>;
  return b.schema === 'kinetwin.baseline' && b.version === 1 && (b.handedness === 'Left' || b.handedness === 'Right') && !!b.jointAngles;
}
