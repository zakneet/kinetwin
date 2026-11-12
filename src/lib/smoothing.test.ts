import { describe, expect, it } from 'vitest';
import { LandmarkSmoother, OneEuroFilter } from './smoothing';
import { std } from './stats';
import { syntheticWorld } from './__fixtures__/syntheticHand';

// Deterministic pseudo-random noise so the test is reproducible.
function noise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  };
}

describe('One Euro filter', () => {
  it('passes a constant signal through unchanged', () => {
    const f = new OneEuroFilter();
    let out = 0;
    for (let i = 0; i < 50; i++) out = f.filter(3.5, i * 33);
    expect(out).toBeCloseTo(3.5, 9);
  });

  it('reduces jitter on a noisy stationary signal', () => {
    const f = new OneEuroFilter({ minCutoff: 1, beta: 0, dCutoff: 1 });
    const rnd = noise(42);
    const raw: number[] = [];
    const filtered: number[] = [];
    for (let i = 0; i < 300; i++) {
      const x = 1 + rnd() * 0.2;
      raw.push(x);
      filtered.push(f.filter(x, i * 33));
    }
    expect(std(filtered.slice(30))!).toBeLessThan(std(raw.slice(30))! * 0.5);
  });

  it('follows a step change', () => {
    const f = new OneEuroFilter();
    for (let i = 0; i < 10; i++) f.filter(0, i * 33);
    let out = 0;
    for (let i = 10; i < 60; i++) out = f.filter(1, i * 33);
    expect(out).toBeGreaterThan(0.95);
  });

  it('ignores duplicate timestamps and non-finite samples', () => {
    const f = new OneEuroFilter();
    f.filter(1, 0);
    expect(f.filter(5, 0)).toBe(1);
    expect(f.filter(NaN, 33)).toBe(1);
    expect(Number.isFinite(f.filter(2, 66))).toBe(true);
  });
});

describe('landmark smoother', () => {
  it('smooths all 21 points and resets after a tracking gap', () => {
    const s = new LandmarkSmoother(undefined, 300);
    const a = syntheticWorld();
    const b = syntheticWorld({ all: { pip: 80 } });
    s.smooth(a, 0);
    const lagging = s.smooth(b, 33);
    expect(lagging).toHaveLength(21);
    // With smoothing, the fingertip has not fully jumped to the new pose yet.
    expect(Math.abs(lagging[8].z - b[8].z)).toBeGreaterThan(1e-4);
    // After a 1 s gap, the filter restarts and outputs the raw pose.
    const restarted = s.smooth(b, 1033);
    expect(restarted[8].z).toBeCloseTo(b[8].z, 9);
  });
});
