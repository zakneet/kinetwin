import { describe, expect, it } from 'vitest';
import { applyBasis, normalizedToPixel, palmAlignmentBasis, resolveHandedness, worldSetToScene, worldToScene } from './transforms';
import { cross, dot, normalize, sub } from './vec3';
import { syntheticWorld } from './__fixtures__/syntheticHand';
import { computePalmFrame } from './angles';
import { isValidLandmarkSet, sanitizeLandmarks, flattenLandmarks, unflattenLandmarks } from './landmarks';

function triple(p: ReturnType<typeof syntheticWorld>) {
  return dot(cross(sub(p[5], p[0]), sub(p[17], p[0])), sub(p[4], p[0]));
}

describe('coordinate mapping', () => {
  it('maps MediaPipe world axes (y down, z away) to scene axes (y up, z toward viewer)', () => {
    expect(worldToScene({ x: 0.1, y: 0.2, z: 0.3 }, 10)).toEqual({ x: 1, y: -2, z: -3 });
  });

  it('preserves chirality (a right hand stays a right hand)', () => {
    const w = syntheticWorld({ handedness: 'Right', thumb: { mcp: 20 } });
    const s = worldSetToScene(w, 10);
    expect(Math.sign(triple(s))).toBe(Math.sign(triple(w)));
  });

  it('maps normalized landmarks to pixels with optional mirroring', () => {
    expect(normalizedToPixel({ x: 0.25, y: 0.5, z: 0 }, 640, 480, false)).toEqual({ x: 160, y: 240 });
    expect(normalizedToPixel({ x: 0.25, y: 0.5, z: 0 }, 640, 480, true)).toEqual({ x: 480, y: 240 });
  });

  it('builds a proper rotation that turns the palm toward the viewer for both hands', () => {
    for (const h of ['Right', 'Left'] as const) {
      const scene = worldSetToScene(syntheticWorld({ handedness: h, rotation: [20, 70, -30] }), 1);
      const frame = computePalmFrame(scene, h);
      expect(frame).not.toBeNull();
      const m = palmAlignmentBasis(frame!.distal, frame!.radial, h)!;
      // determinant +1 → no mirroring
      const det =
        m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
      expect(det).toBeCloseTo(1, 6);
      const d = applyBasis(m, frame!.distal);
      expect(d.y).toBeCloseTo(1, 6);
      const radialAfter = applyBasis(m, frame!.radial);
      expect(Math.sign(radialAfter.x)).toBe(h === 'Right' ? 1 : -1);
    }
  });

  it('returns null for a degenerate palm basis', () => {
    expect(palmAlignmentBasis({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 'Right')).toBeNull();
  });
});

describe('handedness resolution', () => {
  it('passes labels through by default and swaps on request or for mirrored input', () => {
    expect(resolveHandedness('Left', { inputMirrored: false, swap: false })).toBe('Left');
    expect(resolveHandedness('Left', { inputMirrored: false, swap: true })).toBe('Right');
    expect(resolveHandedness('Right', { inputMirrored: true, swap: false })).toBe('Left');
    expect(resolveHandedness('Right', { inputMirrored: true, swap: true })).toBe('Right');
    expect(resolveHandedness(undefined, { inputMirrored: false, swap: false })).toBeNull();
    expect(resolveHandedness('Unknown', { inputMirrored: false, swap: false })).toBeNull();
  });
});

describe('landmark validation', () => {
  it('rejects wrong lengths and non-finite values', () => {
    const w = syntheticWorld();
    expect(isValidLandmarkSet(w)).toBe(true);
    expect(isValidLandmarkSet(w.slice(1))).toBe(false);
    expect(isValidLandmarkSet([...w.slice(1), { x: NaN, y: 0, z: 0 }])).toBe(false);
    expect(sanitizeLandmarks(null)).toBeNull();
    expect(sanitizeLandmarks([...w.slice(1), { x: 0, y: Infinity, z: 0 }])).toBeNull();
    expect(sanitizeLandmarks(w)).toHaveLength(21);
  });

  it('round-trips flattened landmarks', () => {
    const w = syntheticWorld({ all: { pip: 30 } });
    const back = unflattenLandmarks(flattenLandmarks(w, 6))!;
    back.forEach((p, i) => {
      expect(p.x).toBeCloseTo(w[i].x, 5);
      expect(p.z).toBeCloseTo(w[i].z, 5);
    });
    expect(unflattenLandmarks([1, 2, 3])).toBeNull();
    expect(normalize({ x: 3, y: 4, z: 0 })).toEqual({ x: 0.6, y: 0.8, z: 0 });
  });
});
