import { isFiniteVec, type Vec3 } from './vec3';

/** MediaPipe Hand Landmarker indices (21 points). */
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1, // proxy: MediaPipe's point 1 sits near the trapeziometacarpal joint
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  LITTLE_MCP: 17,
  LITTLE_PIP: 18,
  LITTLE_DIP: 19,
  LITTLE_TIP: 20,
} as const;

export const LANDMARK_COUNT = 21;

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'little'] as const;
export type FingerName = (typeof FINGERS)[number];
export const LONG_FINGERS = ['index', 'middle', 'ring', 'little'] as const;
export type LongFingerName = (typeof LONG_FINGERS)[number];

export const FINGER_LABEL: Record<FingerName, string> = {
  thumb: 'Thumb',
  index: 'Index',
  middle: 'Middle',
  ring: 'Ring',
  little: 'Little',
};

/** Landmark chain from the most proximal tracked point to the tip. */
export const FINGER_CHAIN: Record<FingerName, readonly [number, number, number, number]> = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  little: [17, 18, 19, 20],
};

export const FINGERTIP: Record<FingerName, number> = {
  thumb: 4,
  index: 8,
  middle: 12,
  ring: 16,
  little: 20,
};

export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export type Handedness = 'Left' | 'Right';

/** One tracked hand at one instant. Coordinates are exactly what MediaPipe reports (after smoothing). */
export interface HandFrame {
  /** Timestamp in ms (performance.now() for live frames, session time for recordings). */
  t: number;
  /** 21 normalized image landmarks: x,y in [0,1] of the *unmirrored* camera image, z relative depth. */
  landmarks: Vec3[];
  /** 21 world landmarks in metres, origin near the hand's geometric centre (MediaPipe convention). */
  world: Vec3[];
  handedness: Handedness;
  /** Handedness classifier score (0..1) reported by MediaPipe. */
  handednessScore: number;
}

/** True when `pts` is an array of exactly 21 finite 3D points. */
export function isValidLandmarkSet(pts: unknown): pts is Vec3[] {
  if (!Array.isArray(pts) || pts.length !== LANDMARK_COUNT) return false;
  for (const p of pts) if (!isFiniteVec(p)) return false;
  return true;
}

/**
 * Converts raw landmark-like objects (MediaPipe NormalizedLandmark / Landmark)
 * into clean Vec3 values. Returns null if any point is missing or non-finite,
 * so downstream maths never receives NaN.
 */
export function sanitizeLandmarks(raw: ReadonlyArray<{ x: number; y: number; z: number }> | null | undefined): Vec3[] | null {
  if (!raw || raw.length !== LANDMARK_COUNT) return null;
  const out: Vec3[] = new Array(LANDMARK_COUNT);
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const p = raw[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return null;
    out[i] = { x: p.x, y: p.y, z: p.z };
  }
  return out;
}

export function flattenLandmarks(pts: Vec3[], decimals = 5): number[] {
  const f = 10 ** decimals;
  const out: number[] = new Array(pts.length * 3);
  for (let i = 0; i < pts.length; i++) {
    // `+ 0` normalises -0 so values survive a JSON round trip unchanged.
    out[i * 3] = Math.round(pts[i].x * f) / f + 0;
    out[i * 3 + 1] = Math.round(pts[i].y * f) / f + 0;
    out[i * 3 + 2] = Math.round(pts[i].z * f) / f + 0;
  }
  return out;
}

export function unflattenLandmarks(flat: unknown): Vec3[] | null {
  if (!Array.isArray(flat) || flat.length !== LANDMARK_COUNT * 3) return null;
  const out: Vec3[] = new Array(LANDMARK_COUNT);
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const x = flat[i * 3];
    const y = flat[i * 3 + 1];
    const z = flat[i * 3 + 2];
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    out[i] = { x, y, z };
  }
  return out;
}
