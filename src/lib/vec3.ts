// Minimal, allocation-light 3D vector helpers used by the biomechanics code.
// All functions are pure and tolerate degenerate input by returning null
// instead of NaN, so callers can decide how to surface "not measurable".

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const EPS = 1e-9;
export const RAD2DEG = 180 / Math.PI;
export const DEG2RAD = Math.PI / 180;

export function v3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function isFiniteVec(p: unknown): p is Vec3 {
  if (!p || typeof p !== 'object') return false;
  const q = p as Record<string, unknown>;
  return (
    typeof q.x === 'number' &&
    typeof q.y === 'number' &&
    typeof q.z === 'number' &&
    Number.isFinite(q.x) &&
    Number.isFinite(q.y) &&
    Number.isFinite(q.z)
  );
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function length(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Unit vector, or null when the input has (near) zero length. */
export function normalize(a: Vec3): Vec3 | null {
  const l = length(a);
  if (!Number.isFinite(l) || l < EPS) return null;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/** Component of `a` orthogonal to unit vector `n`. */
export function rejectFrom(a: Vec3, n: Vec3): Vec3 {
  const d = dot(a, n);
  return { x: a.x - n.x * d, y: a.y - n.y * d, z: a.z - n.z * d };
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Unsigned angle between two vectors in degrees (0..180), or null if either
 * vector is degenerate. Uses atan2(|a×b|, a·b), which stays accurate near
 * 0° and 180° where acos loses precision.
 */
export function angleBetween(a: Vec3, b: Vec3): number | null {
  const la = length(a);
  const lb = length(b);
  if (la < EPS || lb < EPS || !Number.isFinite(la) || !Number.isFinite(lb)) return null;
  const c = length(cross(a, b));
  const d = dot(a, b);
  const ang = Math.atan2(c, d) * RAD2DEG;
  return Number.isFinite(ang) ? ang : null;
}

/** Mean of a list of points; null for an empty list. */
export function centroid(points: Vec3[]): Vec3 | null {
  if (points.length === 0) return null;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  return { x: x / points.length, y: y / points.length, z: z / points.length };
}
