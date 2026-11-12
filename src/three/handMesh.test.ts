import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FingerTube, Forearm, PalmSurface, superFalloff } from './handMesh';
import { computePalmFrame } from '../lib/angles';
import { worldSetToScene } from '../lib/transforms';
import { syntheticWorld } from '../lib/__fixtures__/syntheticHand';

function allFinite(arr: ArrayLike<number>): boolean {
  for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) return false;
  return true;
}

const style = { radii: [0.2, 0.19, 0.17, 0.15, 0.13], bulge: [0, 0.05, 0.08, 0.06, 0], width: 1.1 };
const white = (_s: number, _t: number, out: THREE.Color) => out.set('#ffffff');

describe('procedural finger tube', () => {
  it('builds a closed tube that ends exactly at the fingertip landmark', () => {
    const tube = new FingerTube(5);
    const ctrl = [new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.8, 0), new THREE.Vector3(0, 1.3, 0.1), new THREE.Vector3(0, 1.7, 0.25)];
    tube.update(ctrl, style, new THREE.Vector3(0, 0, -1), white);
    const pos = tube.geometry.attributes.position.array;
    expect(allFinite(pos)).toBe(true);
    expect(allFinite(tube.geometry.attributes.normal.array)).toBe(true);
    // last vertex = tip pole
    const n = pos.length;
    expect(pos[n - 3]).toBeCloseTo(0, 6);
    expect(pos[n - 2]).toBeCloseTo(1.7, 6);
    expect(pos[n - 1]).toBeCloseTo(0.25, 6);
    expect(allFinite(tube.nailGeometry.attributes.position.array)).toBe(true);
  });

  it('stays finite for collapsed (degenerate) landmarks', () => {
    const tube = new FingerTube(5);
    const p = new THREE.Vector3(1, 1, 1);
    tube.update([p, p.clone(), p.clone(), p.clone(), p.clone()], style, new THREE.Vector3(0, 0, 1), white);
    expect(allFinite(tube.geometry.attributes.position.array)).toBe(true);
    expect(allFinite(tube.nailGeometry.attributes.position.array)).toBe(true);
  });
});

describe('palm and forearm surfaces', () => {
  it('follow the landmarks of a tracked hand without NaN', () => {
    for (const h of ['Right', 'Left'] as const) {
      const scene = worldSetToScene(syntheticWorld({ handedness: h, all: { mcp: 30, pip: 40 }, rotation: [10, 40, 0] }), 18);
      const P = scene.map((v) => new THREE.Vector3(v.x, v.y, v.z));
      const f = computePalmFrame(scene, h)!;
      const palm = new PalmSurface();
      const dorsal = new THREE.Vector3(-f.palmar.x, -f.palmar.y, -f.palmar.z);
      const distal = new THREE.Vector3(f.distal.x, f.distal.y, f.distal.z);
      const radial = new THREE.Vector3(f.radial.x, f.radial.y, f.radial.z);
      const pw = P[5].distanceTo(P[17]);
      palm.update({ p: P, distal, radial, dorsal, palmWidth: pw, baseRadius: [0.17 * pw, 0.17 * pw, 0.16 * pw, 0.14 * pw] }, new THREE.Color('#ffffff'));
      expect(allFinite(palm.geometry.attributes.position.array)).toBe(true);
      // the palm surface encloses the wrist landmark region
      palm.geometry.computeBoundingBox();
      expect(palm.geometry.boundingBox!.containsPoint(P[9].clone().lerp(P[0], 0.5))).toBe(true);
      const fa = new Forearm();
      fa.update(P[0], distal, radial, dorsal, palm, pw, new THREE.Color('#ffffff'));
      expect(allFinite(fa.geometry.attributes.position.array)).toBe(true);
    }
  });

  it('uses a superelliptic edge falloff (1 at centre, 0 at the edge)', () => {
    expect(superFalloff(0)).toBe(1);
    expect(superFalloff(1)).toBe(0);
    expect(superFalloff(-1)).toBe(0);
    expect(superFalloff(0.5)).toBeGreaterThan(0.8);
  });
});
