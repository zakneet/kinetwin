/**
 * Hand-level movement indicators derived from 3D world landmarks and the
 * estimated joint angles. All values are application-defined estimates; none
 * is a clinically validated score.
 */
import { FINGER_JOINTS, type JointAngles } from './angles';
import { FINGER_CHAIN, FINGERTIP, LM, LONG_FINGERS, type FingerName, type LongFingerName } from './landmarks';
import { angleBetween, clamp, distance, normalize, rejectFrom, sub, type Vec3 } from './vec3';
import type { PalmFrame } from './angles';

export interface PalmDimensions {
  /** Wrist (0) → middle MCP (9) distance, metres. Used to normalise distances. */
  palmLength: number;
  /** Index MCP (5) → little MCP (17) distance, metres. */
  palmWidth: number;
}

export function palmDimensions(world: Vec3[] | null | undefined): PalmDimensions | null {
  if (!world || world.length !== 21) return null;
  const palmLength = distance(world[LM.WRIST], world[LM.MIDDLE_MCP]);
  const palmWidth = distance(world[LM.INDEX_MCP], world[LM.LITTLE_MCP]);
  if (!(palmLength > 1e-6) || !(palmWidth > 1e-6) || !Number.isFinite(palmLength) || !Number.isFinite(palmWidth)) return null;
  return { palmLength, palmWidth };
}

export type OppositionTargets = Exclude<FingerName, 'thumb'>;
export type ThumbOpposition = Record<OppositionTargets, number | null>;

/**
 * Thumb-tip to fingertip distances divided by palm length (wrist→middle MCP).
 * Dimensionless, so the value does not depend on hand size or camera distance.
 * 0 would mean the landmark points coincide; MediaPipe tip landmarks sit at
 * the finger ends, so a pad-to-pad pinch typically reads around 0.1–0.25.
 */
export function thumbOpposition(world: Vec3[] | null | undefined): ThumbOpposition {
  const out: ThumbOpposition = { index: null, middle: null, ring: null, little: null };
  const dims = palmDimensions(world);
  if (!world || !dims) return out;
  const tip = world[FINGERTIP.thumb];
  for (const f of LONG_FINGERS) {
    const d = distance(tip, world[FINGERTIP[f]]) / dims.palmLength;
    out[f] = Number.isFinite(d) ? d : null;
  }
  return out;
}

/** Ratio of straight-line MCP→tip distance to the summed segment lengths (1 = fully straight). */
export function fingerStraightness(world: Vec3[] | null | undefined, finger: FingerName): number | null {
  if (!world || world.length !== 21) return null;
  const [a, b, c, d] = FINGER_CHAIN[finger];
  const path = distance(world[a], world[b]) + distance(world[b], world[c]) + distance(world[c], world[d]);
  if (!(path > 1e-9)) return null;
  const r = distance(world[a], world[d]) / path;
  return Number.isFinite(r) ? clamp(r, 0, 1) : null;
}

/**
 * Total estimated flexion of a finger (degrees): MCP (flexion part only) + PIP + DIP
 * for long fingers, MCP + IP for the thumb. Null when any component is missing.
 */
export function fingerFlexionSum(angles: JointAngles, finger: FingerName): number | null {
  const ids = FINGER_JOINTS[finger];
  if (finger === 'thumb') {
    const m = angles.thumb_mcp;
    const ip = angles.thumb_ip;
    return m === null || ip === null ? null : m + ip;
  }
  let sum = 0;
  for (const id of ids) {
    const v = angles[id];
    if (v === null) return null;
    sum += id.endsWith('_mcp') ? Math.max(0, v) : v;
  }
  return sum;
}

/**
 * HAND OPENNESS INDEX (application-defined, 0 = closed fist, 1 = fully open).
 *
 * For each long finger (index, middle, ring, little):
 *   angleTerm    = 1 − clamp(flexionSum / 250°, 0, 1)
 *   straightTerm = clamp((straightness − 0.35) / 0.65, 0, 1)
 *   fingerOpen   = 0.5·angleTerm + 0.5·straightTerm
 * Openness = mean of the available fingers (at least 2 required).
 *
 * The 250° reference and 0.35 straightness floor are design constants chosen
 * so a typical fist reads near 0 and a flat hand near 1. They are NOT
 * population norms. The thumb is excluded because its flexion pattern is
 * not comparable to the long fingers.
 */
export function handOpenness(world: Vec3[] | null | undefined, angles: JointAngles): { value: number | null; perFinger: Record<LongFingerName, number | null> } {
  const perFinger: Record<LongFingerName, number | null> = { index: null, middle: null, ring: null, little: null };
  let sum = 0;
  let n = 0;
  for (const f of LONG_FINGERS) {
    const flex = fingerFlexionSum(angles, f);
    const straight = fingerStraightness(world, f);
    if (flex === null || straight === null) continue;
    const angleTerm = 1 - clamp(flex / 250, 0, 1);
    const straightTerm = clamp((straight - 0.35) / 0.65, 0, 1);
    const v = 0.5 * angleTerm + 0.5 * straightTerm;
    perFinger[f] = v;
    sum += v;
    n++;
  }
  return { value: n >= 2 ? sum / n : null, perFinger };
}

export interface FingerSpread {
  /** Angles (deg) between adjacent proximal phalanges projected on the palm plane. */
  indexMiddle: number | null;
  middleRing: number | null;
  ringLittle: number | null;
  /** Angle between thumb (MCP→tip) and index proximal phalanx, projected on the palm plane. */
  thumbIndex: number | null;
  /** Sum of the three long-finger gaps. */
  totalLong: number | null;
  /** Mean adjacent fingertip distance (index–middle–ring–little) / palm width. */
  tipSpreadRatio: number | null;
}

function projectedAngle(a: Vec3, b: Vec3, normal: Vec3): number | null {
  const pa = rejectFrom(a, normal);
  const pb = rejectFrom(b, normal);
  return angleBetween(pa, pb);
}

/** Finger separation from landmarks (abduction proxy). Requires a palm frame. */
export function fingerSpread(world: Vec3[] | null | undefined, palm: PalmFrame | null): FingerSpread {
  const out: FingerSpread = { indexMiddle: null, middleRing: null, ringLittle: null, thumbIndex: null, totalLong: null, tipSpreadRatio: null };
  if (!world || world.length !== 21) return out;
  const dir = (f: FingerName) => sub(world[FINGER_CHAIN[f][1]], world[FINGER_CHAIN[f][0]]);
  if (palm) {
    out.indexMiddle = projectedAngle(dir('index'), dir('middle'), palm.palmar);
    out.middleRing = projectedAngle(dir('middle'), dir('ring'), palm.palmar);
    out.ringLittle = projectedAngle(dir('ring'), dir('little'), palm.palmar);
    out.thumbIndex = projectedAngle(sub(world[LM.THUMB_TIP], world[LM.THUMB_MCP]), dir('index'), palm.palmar);
    if (out.indexMiddle !== null && out.middleRing !== null && out.ringLittle !== null) {
      out.totalLong = out.indexMiddle + out.middleRing + out.ringLittle;
    }
  }
  const dims = palmDimensions(world);
  if (dims) {
    const d =
      (distance(world[LM.INDEX_TIP], world[LM.MIDDLE_TIP]) +
        distance(world[LM.MIDDLE_TIP], world[LM.RING_TIP]) +
        distance(world[LM.RING_TIP], world[LM.LITTLE_TIP])) /
      3 /
      dims.palmWidth;
    out.tipSpreadRatio = Number.isFinite(d) ? d : null;
  }
  return out;
}

/** Direction of a finger's proximal phalanx (unit), or null. */
export function proximalDirection(world: Vec3[], finger: FingerName): Vec3 | null {
  const [a, b] = FINGER_CHAIN[finger];
  return normalize(sub(world[b], world[a]));
}
