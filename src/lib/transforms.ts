/**
 * Coordinate transformations between MediaPipe frames, the 2D preview and the
 * Three.js scene.
 *
 * MediaPipe world landmarks: metres, origin near the hand centre, axes follow
 * the (unmirrored) image: +x right, +y down, +z away from the camera. This is
 * a right-handed frame.
 *
 * Three.js scene: +x right, +y up, +z toward the viewer (right-handed).
 * The mapping (x, y, z) → (x, −y, −z) is a 180° rotation about the x axis, so
 * it preserves chirality — a right hand stays a right hand. Mirroring for a
 * "selfie" view is applied separately as a scale of −1 on x at the scene
 * graph level (Three.js flips the face winding for negative determinants).
 */
import type { Handedness } from './landmarks';
import type { Vec3 } from './vec3';

export const SCENE_SCALE = 18; // 1 m → 18 scene units (a hand is ~3 units long)

export function worldToScene(p: Vec3, scale = SCENE_SCALE): Vec3 {
  return { x: p.x * scale, y: -p.y * scale, z: -p.z * scale };
}

export function worldSetToScene(points: Vec3[], scale = SCENE_SCALE): Vec3[] {
  return points.map((p) => worldToScene(p, scale));
}

/** Normalized image coordinates → canvas pixels, optionally mirrored for a selfie preview. */
export function normalizedToPixel(p: Vec3, width: number, height: number, mirrored: boolean): { x: number; y: number } {
  const x = mirrored ? (1 - p.x) * width : p.x * width;
  return { x, y: p.y * height };
}

/**
 * Normalises MediaPipe's handedness label.
 *
 * @mediapipe/tasks-vision documents labels as the subject's hand for the image
 * it receives, and notes that a horizontally mirrored input inverts them.
 * `swap` lets the user correct a systematic mismatch (confirmed during
 * calibration) without touching the measurement code.
 */
export function resolveHandedness(label: string | undefined | null, opts: { inputMirrored: boolean; swap: boolean }): Handedness | null {
  if (!label) return null;
  const l = label.trim().toLowerCase();
  let h: Handedness | null = l === 'left' ? 'Left' : l === 'right' ? 'Right' : null;
  if (!h) return null;
  const flip = opts.inputMirrored !== opts.swap; // XOR
  if (flip) h = h === 'Left' ? 'Right' : 'Left';
  return h;
}

/**
 * 3×3 rotation (row-major) that re-orients the hand so that, in scene space,
 * the fingers point up (+y) and the palm faces the viewer (+z). Used for the
 * "anatomical orientation" view, which removes global wrist rotation so finger
 * articulation can be inspected.
 *
 * `distal` and `radial` must be expressed in the same frame as the points the
 * matrix will be applied to. A right hand seen palm-first has its radial
 * (thumb) side on +x, a left hand on −x; the lateral row is signed by
 * handedness and the third row is a cross product, so the result is always a
 * proper rotation (determinant +1) and never mirrors the hand.
 */
export function palmAlignmentBasis(distal: Vec3, radial: Vec3, handedness: Handedness): number[] | null {
  const s = handedness === 'Right' ? 1 : -1;
  const lx = radial.x * s;
  const ly = radial.y * s;
  const lz = radial.z * s;
  // Orthogonalise distal against lateral.
  const d0 = distal.x * lx + distal.y * ly + distal.z * lz;
  let dx = distal.x - lx * d0;
  let dy = distal.y - ly * d0;
  let dz = distal.z - lz * d0;
  const dl = Math.hypot(dx, dy, dz);
  const ll = Math.hypot(lx, ly, lz);
  if (!(dl > 1e-9) || !(ll > 1e-9) || !Number.isFinite(dl)) return null;
  dx /= dl;
  dy /= dl;
  dz /= dl;
  const ax = lx / ll;
  const ay = ly / ll;
  const az = lz / ll;
  // n = lateral × distal
  const nx = ay * dz - az * dy;
  const ny = az * dx - ax * dz;
  const nz = ax * dy - ay * dx;
  return [ax, ay, az, dx, dy, dz, nx, ny, nz];
}

export function applyBasis(m: number[], p: Vec3): Vec3 {
  return {
    x: m[0] * p.x + m[1] * p.y + m[2] * p.z,
    y: m[3] * p.x + m[4] * p.y + m[5] * p.z,
    z: m[6] * p.x + m[7] * p.y + m[8] * p.z,
  };
}
