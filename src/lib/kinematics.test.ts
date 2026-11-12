import { describe, expect, it } from 'vitest';
import { angularVelocity, checkSampling, consistency, detectCycles, resampleUniform, summarizeMovement } from './kinematics';
import { fingerIsolation } from './isolation';

const times = (n: number, dt = 33.3) => Array.from({ length: n }, (_, i) => i * dt);

describe('sampling checks', () => {
  it('accepts 30 Hz tracking and rejects slow or gappy data', () => {
    expect(checkSampling(times(60)).ok).toBe(true);
    expect(checkSampling(times(60)).rateHz).toBeCloseTo(30, 0);
    const slow = checkSampling(times(60, 125));
    expect(slow.ok).toBe(false);
    expect(slow.reason).toMatch(/below/);
    const gappy = [...times(30), ...times(30).map((t) => t + 2000)];
    expect(checkSampling(gappy).ok).toBe(false);
    expect(checkSampling([0]).ok).toBe(false);
  });
});

describe('angular velocity', () => {
  it('equals the slope of a linear ramp (deg/s)', () => {
    const t = times(20);
    const v = angularVelocity(t, t.map((x) => x * 0.09)); // 90 deg/s
    expect(v[0]).toBeNull();
    expect(v[19]).toBeNull();
    for (let i = 1; i < 19; i++) expect(v[i]).toBeCloseTo(90, 6);
  });

  it('does not differentiate across gaps or missing values', () => {
    const t = [0, 33, 66, 1000, 1033, 1066];
    const v = angularVelocity(t, [0, 1, 2, 3, null, 5]);
    expect(v[2]).toBeNull(); // gap after
    expect(v[3]).toBeNull(); // gap before
    expect(v[4]).toBeNull(); // hand not tracked at this instant
    expect(v.every((x) => x === null || Number.isFinite(x))).toBe(true);
  });
});

describe('resampling (replay interpolation helper)', () => {
  it('linearly interpolates onto a uniform grid', () => {
    const r = resampleUniform([0, 100], [0, 10], 20)!;
    expect(r.t).toEqual([0, 50, 100]);
    expect(r.v).toEqual([0, 5, 10]);
    expect(resampleUniform([0], [1], 30)).toBeNull();
  });
});

describe('movement smoothness and duration', () => {
  it('rates a minimum-jerk reach smoother than the same reach with ripples', () => {
    const t = times(61, 1000 / 30); // 2 s at 30 Hz
    const mj = t.map((ms) => {
      const s = Math.min(1, ms / 2000);
      return 90 * (10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5);
    });
    const rippled = mj.map((v, i) => v + 6 * Math.sin(i * 1.3));
    const a = summarizeMovement(t, mj);
    const b = summarizeMovement(t, rippled);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.summary.ldlj!).toBeGreaterThan(b.summary.ldlj!);
      expect(a.summary.speedPeaks).toBeLessThan(b.summary.speedPeaks);
      expect(a.summary.durationSec).toBeGreaterThan(1.2);
      expect(a.summary.durationSec).toBeLessThanOrEqual(2.05);
      expect(a.summary.peakVelocity).toBeCloseTo(90 * 1.875 / 2, -1); // MJ peak = 1.875·A/T
    }
  });

  it('refuses to estimate from insufficient sampling', () => {
    const r = summarizeMovement(times(8, 200), [0, 10, 20, 30, 40, 50, 60, 70]);
    expect(r.ok).toBe(false);
    const flat = summarizeMovement(times(40), new Array(40).fill(5));
    expect(flat.ok).toBe(false);
  });
});

describe('consistency', () => {
  it('is 1 for identical repetitions and lower for variable ones', () => {
    expect(consistency([2, 2, 2])).toBeCloseTo(1, 9);
    expect(consistency([1, 2, 3])!).toBeLessThan(0.7);
    expect(consistency([5])).toBeNull();
  });
});

describe('cycle detection', () => {
  it('counts open→close→open cycles with hysteresis', () => {
    const t = times(300, 33.3); // ~10 s
    const o = t.map((ms) => 0.5 + 0.45 * Math.cos((2 * Math.PI * ms) / 2500)); // 4 full cycles
    const cycles = detectCycles(t, o, 0.25, 0.75);
    expect(cycles.length).toBe(4);
    for (const c of cycles) expect(c.durationMs).toBeGreaterThan(1500);
  });

  it('does not count movement across a tracking gap', () => {
    const t = [0, 33, 66, 2000, 2033, 2066];
    const o = [0.9, 0.9, 0.1, 0.1, 0.9, 0.9];
    expect(detectCycles(t, o, 0.3, 0.7)).toHaveLength(0);
  });
});

describe('finger isolation', () => {
  const ramp = (amp: number) => Array.from({ length: 60 }, (_, i) => amp * Math.sin((i / 60) * Math.PI * 2) * 0.5 + amp / 2);

  it('scores an isolated movement close to 1', () => {
    const r = fingerIsolation({ index: ramp(80), middle: ramp(6), ring: ramp(4), little: ramp(2), thumb: ramp(1) }, 'index');
    expect(r.valid).toBe(true);
    expect(r.independence!).toBeGreaterThan(0.9);
    expect(r.mostCoupled).toBe('middle');
  });

  it('detects unwanted simultaneous movement', () => {
    const r = fingerIsolation({ index: ramp(20), middle: ramp(60), ring: ramp(70), little: ramp(40) }, 'ring');
    expect(r.valid).toBe(true);
    expect(r.unwantedRatio!).toBeGreaterThan(0.5);
    expect(r.independence!).toBeLessThan(0.5);
  });

  it('marks the result invalid when the target finger barely moved', () => {
    const r = fingerIsolation({ index: ramp(5), middle: ramp(3), ring: ramp(2), little: ramp(1) }, 'index');
    expect(r.valid).toBe(false);
    expect(r.independence).toBeNull();
    expect(r.reason).toMatch(/below/);
  });

  it('handles fingers with no data', () => {
    const r = fingerIsolation({ index: [null, null] }, 'index');
    expect(r.valid).toBe(false);
  });
});
