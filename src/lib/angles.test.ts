import { describe, expect, it } from 'vitest';
import { computeJointAngles, computePalmFrame, JOINT_IDS, mcpFlexion, segmentFlexion, anglesToArray, anglesFromArray } from './angles';
import { angleBetween, cross, dot, normalize, v3 } from './vec3';
import { syntheticWorld } from './__fixtures__/syntheticHand';

describe('vector maths', () => {
  it('measures angles between vectors', () => {
    expect(angleBetween(v3(1, 0, 0), v3(0, 1, 0))).toBeCloseTo(90, 6);
    expect(angleBetween(v3(1, 0, 0), v3(2, 0, 0))).toBeCloseTo(0, 6);
    expect(angleBetween(v3(1, 0, 0), v3(-3, 0, 0))).toBeCloseTo(180, 6);
    expect(angleBetween(v3(1, 1, 0), v3(1, 0, 0))).toBeCloseTo(45, 6);
  });

  it('returns null for degenerate vectors instead of NaN', () => {
    expect(angleBetween(v3(0, 0, 0), v3(1, 0, 0))).toBeNull();
    expect(angleBetween(v3(NaN, 0, 0), v3(1, 0, 0))).toBeNull();
    expect(normalize(v3(0, 0, 0))).toBeNull();
  });

  it('cross product follows the right-hand rule', () => {
    const z = cross(v3(1, 0, 0), v3(0, 1, 0));
    expect(z).toEqual({ x: 0, y: 0, z: 1 });
    expect(dot(z, v3(0, 0, 1))).toBe(1);
  });
});

describe('segment flexion', () => {
  it('is 0° for collinear segments and 90° for a right angle', () => {
    expect(segmentFlexion(v3(0, 0, 0), v3(0, 1, 0), v3(0, 2, 0))).toBeCloseTo(0, 6);
    expect(segmentFlexion(v3(0, 0, 0), v3(0, 1, 0), v3(1, 1, 0))).toBeCloseTo(90, 6);
  });

  it('handles missing points', () => {
    expect(segmentFlexion(undefined, v3(0, 1, 0), v3(1, 1, 0))).toBeNull();
    expect(segmentFlexion(v3(0, 0, 0), v3(0, 0, 0), v3(1, 1, 0))).toBeNull();
  });

  it('signs MCP flexion toward the palm as positive', () => {
    const palmar = v3(0, 0, -1);
    const wrist = v3(0, 0, 0);
    const mcp = v3(0, 1, 0);
    expect(mcpFlexion(wrist, mcp, v3(0, 2, -1), palmar)).toBeCloseTo(45, 6);
    expect(mcpFlexion(wrist, mcp, v3(0, 2, 1), palmar)).toBeCloseTo(-45, 6);
    // Lateral deviation is removed by the sagittal projection.
    expect(mcpFlexion(wrist, mcp, v3(0.5, 2, 0), palmar)).toBeCloseTo(0, 6);
  });
});

describe('3D joint-angle estimation', () => {
  it('reads a flat right hand as ~0° at every finger joint', () => {
    const a = computeJointAngles(syntheticWorld({ handedness: 'Right' }), 'Right');
    for (const f of ['index', 'middle', 'ring', 'little'] as const) {
      expect(a[`${f}_mcp` as const]).toBeCloseTo(0, 4);
      expect(a[`${f}_pip` as const]).toBeCloseTo(0, 4);
      expect(a[`${f}_dip` as const]).toBeCloseTo(0, 4);
    }
    expect(a.thumb_mcp).toBeCloseTo(0, 4);
    expect(a.thumb_ip).toBeCloseTo(0, 4);
  });

  it('recovers known MCP / PIP / DIP flexion on a right hand', () => {
    const a = computeJointAngles(syntheticWorld({ handedness: 'Right', all: { mcp: 40, pip: 65, dip: 30 } }), 'Right');
    expect(a.index_mcp).toBeCloseTo(40, 3);
    expect(a.index_pip).toBeCloseTo(65, 3);
    expect(a.index_dip).toBeCloseTo(30, 3);
    expect(a.little_mcp).toBeCloseTo(40, 3);
    expect(a.ring_pip).toBeCloseTo(65, 3);
  });

  it('gives identical angles for the mirrored left hand', () => {
    const r = computeJointAngles(syntheticWorld({ handedness: 'Right', all: { mcp: 25, pip: 50, dip: 20 } }), 'Right');
    const l = computeJointAngles(syntheticWorld({ handedness: 'Left', all: { mcp: 25, pip: 50, dip: 20 } }), 'Left');
    for (const id of JOINT_IDS) expect(l[id]).toBeCloseTo(r[id] as number, 6);
  });

  it('is invariant to global rotation and hand size', () => {
    const base = computeJointAngles(syntheticWorld({ all: { mcp: 30, pip: 45, dip: 15 }, thumb: { mcp: 20, ip: 35 } }), 'Right');
    const moved = computeJointAngles(
      syntheticWorld({ all: { mcp: 30, pip: 45, dip: 15 }, thumb: { mcp: 20, ip: 35 }, rotation: [35, -50, 120], scale: 1.4 }),
      'Right',
    );
    for (const id of JOINT_IDS) expect(moved[id]).toBeCloseTo(base[id] as number, 6);
    expect(base.thumb_mcp).toBeCloseTo(20, 3);
    expect(base.thumb_ip).toBeCloseTo(35, 3);
  });

  it('reports MCP hyperextension as a negative angle', () => {
    const a = computeJointAngles(syntheticWorld({ all: { mcp: -20 } }), 'Right');
    expect(a.middle_mcp).toBeCloseTo(-20, 3);
  });

  it('corrects the palmar side from PIP bending when the handedness label is wrong', () => {
    const world = syntheticWorld({ handedness: 'Right', all: { mcp: 35, pip: 70, dip: 30 } });
    const frame = computePalmFrame(world, 'Left'); // deliberately wrong label
    expect(frame?.palmarSource).toBe('pip-evidence');
    const a = computeJointAngles(world, 'Left');
    expect(a.index_mcp).toBeCloseTo(35, 3);
  });

  it('never returns NaN for missing or corrupted landmarks', () => {
    const empty = computeJointAngles(null, 'Right');
    for (const id of JOINT_IDS) expect(empty[id]).toBeNull();

    const short = computeJointAngles(syntheticWorld().slice(0, 12), 'Right');
    for (const id of JOINT_IDS) expect(short[id]).toBeNull();

    const collapsed = syntheticWorld().map(() => v3(0, 0, 0));
    const c = computeJointAngles(collapsed, 'Right');
    for (const id of JOINT_IDS) {
      const v = c[id];
      expect(v === null || Number.isFinite(v)).toBe(true);
    }
  });

  it('round-trips the compact angle array', () => {
    const a = computeJointAngles(syntheticWorld({ all: { mcp: 12.345, pip: 33.333 } }), 'Right');
    const back = anglesFromArray(anglesToArray(a));
    for (const id of JOINT_IDS) expect(back[id]).toBeCloseTo(a[id] as number, 1);
    expect(anglesFromArray('garbage').index_pip).toBeNull();
  });
});
