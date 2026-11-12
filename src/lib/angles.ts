/**
 * Estimated joint angles from MediaPipe 3D world landmarks.
 *
 * IMPORTANT — these are webcam-based geometric ESTIMATES, not goniometric or
 * clinical measurements. MediaPipe predicts landmark positions from a single
 * RGB image; depth (z) in particular is inferred by the network. Angles below
 * therefore carry model and viewpoint error that is not quantified here.
 *
 * Conventions
 * - Flexion is reported in degrees, 0° = segments collinear (straight).
 * - PIP / DIP / thumb MCP / thumb IP: unsigned angle between consecutive
 *   segment vectors. Hyperextension is NOT distinguished from flexion for
 *   these joints (both produce a positive magnitude).
 * - Finger MCP (APPROXIMATE): MediaPipe does not track the metacarpal bones'
 *   carpal ends. The metacarpal axis is approximated by the straight line
 *   wrist(0) → MCP. The proximal phalanx direction is projected onto the plane
 *   spanned by that axis and the palmar normal, and the signed angle in that
 *   plane is reported (positive = toward the palm, negative = hyperextension).
 *   Lateral deviation (abduction) is removed by the projection.
 * - Thumb CMC (PROXY, APPROXIMATE): landmark 1 only approximates the
 *   trapeziometacarpal joint. We report the angle between the thumb
 *   metacarpal proxy (1→2) and the index metacarpal proxy (0→5). It mixes
 *   palmar and radial abduction and is a separation indicator, not a CMC
 *   flexion angle.
 */
import { FINGER_CHAIN, LM, type FingerName, type Handedness } from './landmarks';
import { angleBetween, cross, dot, normalize, RAD2DEG, rejectFrom, sub, type Vec3 } from './vec3';

export type JointKind = 'CMC' | 'MCP' | 'PIP' | 'DIP' | 'IP';

export interface JointDef {
  id: JointId;
  finger: FingerName;
  kind: JointKind;
  /** Landmark index at which the joint sits. */
  landmark: number;
  /** True when the definition relies on an anatomical approximation (see file header). */
  approximate: boolean;
  /** True when the value can be negative (hyperextension). */
  signed: boolean;
  label: string;
}

export const JOINT_IDS = [
  'thumb_cmc', 'thumb_mcp', 'thumb_ip',
  'index_mcp', 'index_pip', 'index_dip',
  'middle_mcp', 'middle_pip', 'middle_dip',
  'ring_mcp', 'ring_pip', 'ring_dip',
  'little_mcp', 'little_pip', 'little_dip',
] as const;
export type JointId = (typeof JOINT_IDS)[number];

export const JOINTS: readonly JointDef[] = [
  { id: 'thumb_cmc', finger: 'thumb', kind: 'CMC', landmark: LM.THUMB_CMC, approximate: true, signed: false, label: 'Thumb CMC (proxy)' },
  { id: 'thumb_mcp', finger: 'thumb', kind: 'MCP', landmark: LM.THUMB_MCP, approximate: false, signed: false, label: 'Thumb MCP' },
  { id: 'thumb_ip', finger: 'thumb', kind: 'IP', landmark: LM.THUMB_IP, approximate: false, signed: false, label: 'Thumb IP' },
  { id: 'index_mcp', finger: 'index', kind: 'MCP', landmark: LM.INDEX_MCP, approximate: true, signed: true, label: 'Index MCP' },
  { id: 'index_pip', finger: 'index', kind: 'PIP', landmark: LM.INDEX_PIP, approximate: false, signed: false, label: 'Index PIP' },
  { id: 'index_dip', finger: 'index', kind: 'DIP', landmark: LM.INDEX_DIP, approximate: false, signed: false, label: 'Index DIP' },
  { id: 'middle_mcp', finger: 'middle', kind: 'MCP', landmark: LM.MIDDLE_MCP, approximate: true, signed: true, label: 'Middle MCP' },
  { id: 'middle_pip', finger: 'middle', kind: 'PIP', landmark: LM.MIDDLE_PIP, approximate: false, signed: false, label: 'Middle PIP' },
  { id: 'middle_dip', finger: 'middle', kind: 'DIP', landmark: LM.MIDDLE_DIP, approximate: false, signed: false, label: 'Middle DIP' },
  { id: 'ring_mcp', finger: 'ring', kind: 'MCP', landmark: LM.RING_MCP, approximate: true, signed: true, label: 'Ring MCP' },
  { id: 'ring_pip', finger: 'ring', kind: 'PIP', landmark: LM.RING_PIP, approximate: false, signed: false, label: 'Ring PIP' },
  { id: 'ring_dip', finger: 'ring', kind: 'DIP', landmark: LM.RING_DIP, approximate: false, signed: false, label: 'Ring DIP' },
  { id: 'little_mcp', finger: 'little', kind: 'MCP', landmark: LM.LITTLE_MCP, approximate: true, signed: true, label: 'Little MCP' },
  { id: 'little_pip', finger: 'little', kind: 'PIP', landmark: LM.LITTLE_PIP, approximate: false, signed: false, label: 'Little PIP' },
  { id: 'little_dip', finger: 'little', kind: 'DIP', landmark: LM.LITTLE_DIP, approximate: false, signed: false, label: 'Little DIP' },
];

export const JOINT_BY_ID: Record<JointId, JointDef> = Object.fromEntries(JOINTS.map((j) => [j.id, j])) as Record<JointId, JointDef>;

export const FINGER_JOINTS: Record<FingerName, readonly JointId[]> = {
  thumb: ['thumb_cmc', 'thumb_mcp', 'thumb_ip'],
  index: ['index_mcp', 'index_pip', 'index_dip'],
  middle: ['middle_mcp', 'middle_pip', 'middle_dip'],
  ring: ['ring_mcp', 'ring_pip', 'ring_dip'],
  little: ['little_mcp', 'little_pip', 'little_dip'],
};

export type JointAngles = Record<JointId, number | null>;

export function emptyAngles(): JointAngles {
  return Object.fromEntries(JOINT_IDS.map((id) => [id, null])) as JointAngles;
}

export interface PalmFrame {
  /** Wrist → middle MCP, unit. */
  distal: Vec3;
  /** Little MCP → index MCP (radial direction), orthogonalised to `distal`, unit. */
  radial: Vec3;
  /** Unit normal pointing out of the palm (palmar side). */
  palmar: Vec3;
  /** How the palmar side was decided. */
  palmarSource: 'handedness' | 'pip-evidence';
}

/**
 * Builds an orthonormal palm frame.
 *
 * The palm plane is defined by wrist(0), index MCP(5) and little MCP(17).
 * Which side of that plane is palmar depends on hand chirality: in the
 * MediaPipe world frame (x right, y down, z away from the camera, all in the
 * unmirrored image) cross(5−0, 17−0) points to the palmar side of a RIGHT
 * hand, and to the dorsal side of a LEFT hand.
 *
 * Because the handedness label can be wrong, the choice is cross-checked
 * against the direction in which flexed PIP joints bend (PIP joints cannot
 * hyperextend substantially, so a clearly flexed PIP bends toward the palm).
 */
export function computePalmFrame(world: Vec3[], handedness: Handedness): PalmFrame | null {
  const w = world[LM.WRIST];
  const i5 = world[LM.INDEX_MCP];
  const m9 = world[LM.MIDDLE_MCP];
  const l17 = world[LM.LITTLE_MCP];
  if (!w || !i5 || !m9 || !l17) return null;

  const distal = normalize(sub(m9, w));
  if (!distal) return null;
  const radialRaw = normalize(rejectFrom(sub(i5, l17), distal));
  if (!radialRaw) return null;
  const n = normalize(cross(sub(i5, w), sub(l17, w)));
  if (!n) return null;

  let palmar = handedness === 'Right' ? n : { x: -n.x, y: -n.y, z: -n.z };
  let palmarSource: PalmFrame['palmarSource'] = 'handedness';

  // PIP evidence: for each long finger with a clearly flexed PIP, check toward
  // which side of the palm plane the middle phalanx bends.
  let evidence = 0;
  let votes = 0;
  for (const f of ['index', 'middle', 'ring', 'little'] as const) {
    const [mcp, pip, dip] = FINGER_CHAIN[f];
    const a = world[mcp];
    const b = world[pip];
    const c = world[dip];
    if (!a || !b || !c) continue;
    const v1 = sub(b, a);
    const v2 = sub(c, b);
    const ang = angleBetween(v1, v2);
    if (ang === null || ang < 30) continue;
    const u1 = normalize(v1);
    if (!u1) continue;
    const bend = normalize(rejectFrom(v2, u1));
    if (!bend) continue;
    evidence += dot(bend, palmar);
    votes++;
  }
  if (votes >= 2 && evidence / votes < -0.35) {
    palmar = { x: -palmar.x, y: -palmar.y, z: -palmar.z };
    palmarSource = 'pip-evidence';
  }

  // Re-orthogonalise palmar against distal for a clean frame.
  const palmarOrtho = normalize(rejectFrom(palmar, distal));
  if (!palmarOrtho) return null;
  return { distal, radial: radialRaw, palmar: palmarOrtho, palmarSource };
}

/** Unsigned flexion at joint B between segments A→B and B→C (0° = straight). */
export function segmentFlexion(a: Vec3 | undefined, b: Vec3 | undefined, c: Vec3 | undefined): number | null {
  if (!a || !b || !c) return null;
  return angleBetween(sub(b, a), sub(c, b));
}

/**
 * Signed MCP flexion (APPROXIMATE). Metacarpal axis proxy = wrist → MCP.
 * The proximal phalanx (MCP → PIP) is projected onto the sagittal plane of
 * the finger (spanned by the metacarpal proxy and the palmar normal) and the
 * signed angle is returned: + toward palm (flexion), − hyperextension.
 */
export function mcpFlexion(wrist: Vec3, mcp: Vec3, pip: Vec3, palmar: Vec3): number | null {
  const axis = normalize(sub(mcp, wrist));
  const phal = sub(pip, mcp);
  if (!axis) return null;
  const pn = normalize(rejectFrom(palmar, axis));
  if (!pn) return null;
  const along = dot(phal, axis);
  const toward = dot(phal, pn);
  if (Math.abs(along) < 1e-9 && Math.abs(toward) < 1e-9) return null;
  const ang = Math.atan2(toward, along) * RAD2DEG;
  return Number.isFinite(ang) ? ang : null;
}

/** Computes every estimated joint angle. Missing/degenerate geometry yields null, never NaN. */
export function computeJointAngles(world: Vec3[] | null | undefined, handedness: Handedness, palm?: PalmFrame | null): JointAngles {
  const out = emptyAngles();
  if (!world || world.length !== 21) return out;
  const frame = palm === undefined ? computePalmFrame(world, handedness) : palm;
  const W = world[LM.WRIST];

  // Thumb
  const thumbMeta = sub(world[LM.THUMB_MCP], world[LM.THUMB_CMC]);
  const indexMeta = sub(world[LM.INDEX_MCP], W);
  out.thumb_cmc = angleBetween(thumbMeta, indexMeta);
  out.thumb_mcp = segmentFlexion(world[LM.THUMB_CMC], world[LM.THUMB_MCP], world[LM.THUMB_IP]);
  out.thumb_ip = segmentFlexion(world[LM.THUMB_MCP], world[LM.THUMB_IP], world[LM.THUMB_TIP]);

  for (const f of ['index', 'middle', 'ring', 'little'] as const) {
    const [mcp, pip, dip, tip] = FINGER_CHAIN[f];
    out[`${f}_mcp` as JointId] = frame ? mcpFlexion(W, world[mcp], world[pip], frame.palmar) : null;
    out[`${f}_pip` as JointId] = segmentFlexion(world[mcp], world[pip], world[dip]);
    out[`${f}_dip` as JointId] = segmentFlexion(world[pip], world[dip], world[tip]);
  }
  for (const id of JOINT_IDS) {
    const v = out[id];
    if (v !== null && !Number.isFinite(v)) out[id] = null;
  }
  return out;
}

/** Joint angles as an array in JOINT_IDS order (compact storage). */
export function anglesToArray(a: JointAngles, decimals = 2): (number | null)[] {
  const f = 10 ** decimals;
  return JOINT_IDS.map((id) => {
    const v = a[id];
    return v === null || !Number.isFinite(v) ? null : Math.round(v * f) / f + 0;
  });
}

export function anglesFromArray(arr: unknown): JointAngles {
  const out = emptyAngles();
  if (!Array.isArray(arr)) return out;
  JOINT_IDS.forEach((id, i) => {
    const v = arr[i];
    out[id] = typeof v === 'number' && Number.isFinite(v) ? v : null;
  });
  return out;
}
