/**
 * TEST-ONLY geometric fixture. Builds a hand skeleton with known joint angles
 * by forward kinematics, in MediaPipe's world-landmark convention (x right,
 * y down, z away from the camera). Used exclusively by unit tests to verify
 * the angle maths; it is never imported by the application.
 */
import type { FingerName, Handedness } from '../landmarks';
import type { Vec3 } from '../vec3';

export interface FingerPose {
  mcp?: number;
  pip?: number;
  dip?: number;
  /** Abduction (deg) in the palm plane, + toward the radial (thumb) side. */
  abd?: number;
}

export interface SyntheticOptions {
  handedness?: Handedness;
  all?: FingerPose;
  fingers?: Partial<Record<Exclude<FingerName, 'thumb'>, FingerPose>>;
  thumb?: { mcp?: number; ip?: number };
  /** Uniform scale factor (hand size / camera distance). */
  scale?: number;
  /** Rotation applied to all points (Euler XYZ, degrees). */
  rotation?: [number, number, number];
}

const D = Math.PI / 180;

const MCP_POS: Record<Exclude<FingerName, 'thumb'>, Vec3> = {
  index: { x: 0.03, y: -0.04, z: 0 },
  middle: { x: 0.008, y: -0.045, z: 0 },
  ring: { x: -0.013, y: -0.042, z: 0 },
  little: { x: -0.032, y: -0.033, z: 0 },
};
const SEG: Record<Exclude<FingerName, 'thumb'>, [number, number, number]> = {
  index: [0.04, 0.025, 0.02],
  middle: [0.045, 0.028, 0.022],
  ring: [0.042, 0.026, 0.021],
  little: [0.033, 0.019, 0.018],
};
const WRIST: Vec3 = { x: 0, y: 0.05, z: 0 };
const PALMAR: Vec3 = { x: 0, y: 0, z: -1 }; // palm faces the camera
const RADIAL: Vec3 = { x: 1, y: 0, z: 0 }; // right hand, palm to camera: thumb on +x

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function mul(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function rotate(p: Vec3, [ax, ay, az]: [number, number, number]): Vec3 {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(ax * D), Math.sin(ax * D), Math.cos(ay * D), Math.sin(ay * D), Math.cos(az * D), Math.sin(az * D)];
  let { x, y, z } = p;
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  return { x, y, z };
}

export function syntheticWorld(opts: SyntheticOptions = {}): Vec3[] {
  const pts: Vec3[] = new Array(21);
  pts[0] = { ...WRIST };
  // Thumb: metacarpal points up/out/forward; MCP and IP flex about a fixed axis.
  const cmc: Vec3 = { x: 0.022, y: 0.032, z: -0.008 };
  const tDir = norm({ x: 0.65, y: -0.7, z: -0.3 });
  const tAxisBend = norm({ x: -0.5, y: -0.1, z: -0.85 }); // bend direction (toward palm centre)
  const tPerp = norm(add(tAxisBend, mul(tDir, -(tAxisBend.x * tDir.x + tAxisBend.y * tDir.y + tAxisBend.z * tDir.z))));
  const thumbMcp = (opts.thumb?.mcp ?? 0) * D;
  const thumbIp = (opts.thumb?.ip ?? 0) * D;
  const seg = (cum: number) => add(mul(tDir, Math.cos(cum)), mul(tPerp, Math.sin(cum)));
  pts[1] = cmc;
  pts[2] = add(pts[1], mul(tDir, 0.035));
  pts[3] = add(pts[2], mul(seg(thumbMcp), 0.03));
  pts[4] = add(pts[3], mul(seg(thumbMcp + thumbIp), 0.025));

  const chains: Record<Exclude<FingerName, 'thumb'>, number[]> = {
    index: [5, 6, 7, 8],
    middle: [9, 10, 11, 12],
    ring: [13, 14, 15, 16],
    little: [17, 18, 19, 20],
  };
  for (const f of ['index', 'middle', 'ring', 'little'] as const) {
    const pose = { ...opts.all, ...opts.fingers?.[f] };
    const mcp = MCP_POS[f];
    const axis0 = norm({ x: mcp.x - WRIST.x, y: mcp.y - WRIST.y, z: mcp.z - WRIST.z });
    // Remove any radial component from the base direction then apply abduction.
    const abd = (pose.abd ?? 0) * D;
    const lateral = norm({ x: RADIAL.x - axis0.x * (axis0.x * RADIAL.x + axis0.y * RADIAL.y), y: RADIAL.y - axis0.y * (axis0.x * RADIAL.x + axis0.y * RADIAL.y), z: 0 });
    const dir0 = norm(add(mul(axis0, Math.cos(abd)), mul(lateral, Math.sin(abd))));
    const angles = [(pose.mcp ?? 0) * D, (pose.pip ?? 0) * D, (pose.dip ?? 0) * D];
    const [i0, i1, i2, i3] = chains[f];
    pts[i0] = { ...mcp };
    // MCP flexion is measured relative to the wrist→MCP line, so bend from axis0 in its sagittal plane.
    let cum = 0;
    let prev = pts[i0];
    const idx = [i1, i2, i3];
    for (let k = 0; k < 3; k++) {
      cum += angles[k];
      const base = k === 0 ? dir0 : dir0;
      const d = add(mul(base, Math.cos(cum)), mul(PALMAR, Math.sin(cum)));
      const p = add(prev, mul(norm(d), SEG[f][k]));
      pts[idx[k]] = p;
      prev = p;
    }
  }

  const s = opts.scale ?? 1;
  let out = pts.map((p) => mul(p, s));
  if (opts.handedness === 'Left') out = out.map((p) => ({ x: -p.x, y: p.y, z: p.z }));
  if (opts.rotation) out = out.map((p) => rotate(p, opts.rotation!));
  return out;
}

/** Fake normalized image landmarks derived from the world points (orthographic projection). */
export function syntheticImage(world: Vec3[]): Vec3[] {
  return world.map((p) => ({ x: 0.5 + p.x * 3, y: 0.5 + p.y * 3, z: p.z }));
}

export function syntheticFrame(opts: SyntheticOptions = {}, t = 0) {
  const world = syntheticWorld(opts);
  return {
    t,
    world,
    landmarks: syntheticImage(world),
    handedness: (opts.handedness ?? 'Right') as Handedness,
    handednessScore: 0.97,
  };
}
