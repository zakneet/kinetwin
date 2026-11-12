import { describe, expect, it } from 'vitest';
import { computeJointAngles, computePalmFrame } from './angles';
import { analyzeFrame } from './analysis';
import { fingerSpread, handOpenness, palmDimensions, thumbOpposition, fingerFlexionSum } from './metrics';
import { computeRange, RangeTracker, percentile, mean } from './stats';
import { syntheticWorld } from './__fixtures__/syntheticHand';

describe('hand openness (application-defined index)', () => {
  it('is near 1 for a flat hand and low for a fist', () => {
    const flat = syntheticWorld();
    const fist = syntheticWorld({ all: { mcp: 85, pip: 100, dip: 70 } });
    const o1 = handOpenness(flat, computeJointAngles(flat, 'Right')).value!;
    const o2 = handOpenness(fist, computeJointAngles(fist, 'Right')).value!;
    expect(o1).toBeGreaterThan(0.95);
    expect(o2).toBeLessThan(0.2);
  });

  it('decreases monotonically as the fingers flex', () => {
    let prev = Infinity;
    for (const k of [0, 0.25, 0.5, 0.75, 1]) {
      const w = syntheticWorld({ all: { mcp: 80 * k, pip: 95 * k, dip: 60 * k } });
      const o = handOpenness(w, computeJointAngles(w, 'Right')).value!;
      expect(o).toBeLessThan(prev);
      prev = o;
    }
  });

  it('returns null when landmarks are missing', () => {
    const r = handOpenness(null, computeJointAngles(null, 'Right'));
    expect(r.value).toBeNull();
  });
});

describe('thumb opposition distances', () => {
  it('is normalised by palm length (independent of hand size)', () => {
    const small = thumbOpposition(syntheticWorld({ scale: 0.8 }));
    const large = thumbOpposition(syntheticWorld({ scale: 1.3 }));
    expect(small.index).toBeCloseTo(large.index!, 9);
    expect(small.little).toBeCloseTo(large.little!, 9);
  });

  it('reaches ~0 when the thumb tip touches a fingertip', () => {
    const w = syntheticWorld();
    w[4] = { ...w[12] };
    const d = thumbOpposition(w);
    expect(d.middle).toBeCloseTo(0, 9);
    expect(d.index!).toBeGreaterThan(0);
  });

  it('orders distances by finger for an open hand', () => {
    const d = thumbOpposition(syntheticWorld());
    expect(d.index!).toBeLessThan(d.little!);
  });

  it('handles missing data', () => {
    expect(thumbOpposition(undefined)).toEqual({ index: null, middle: null, ring: null, little: null });
    expect(palmDimensions(syntheticWorld().slice(0, 4))).toBeNull();
  });
});

describe('finger spread', () => {
  it('measures abduction between adjacent fingers on the palm plane', () => {
    const closed = syntheticWorld();
    const spread = syntheticWorld({ fingers: { index: { abd: 12 }, ring: { abd: -8 }, little: { abd: -20 } } });
    const s0 = fingerSpread(closed, computePalmFrame(closed, 'Right'));
    const s1 = fingerSpread(spread, computePalmFrame(spread, 'Right'));
    expect(s1.totalLong!).toBeGreaterThan(s0.totalLong!);
    expect(s1.indexMiddle! - s0.indexMiddle!).toBeCloseTo(12, 0);
    expect(s1.tipSpreadRatio!).toBeGreaterThan(s0.tipSpreadRatio!);
  });

  it('returns nulls without a palm frame or landmarks', () => {
    const s = fingerSpread(null, null);
    expect(s.totalLong).toBeNull();
    expect(s.tipSpreadRatio).toBeNull();
  });
});

describe('frame analysis', () => {
  it('combines all estimates and sums finger flexion', () => {
    const w = syntheticWorld({ all: { mcp: 10, pip: 20, dip: 30 } });
    const a = analyzeFrame({ world: w, handedness: 'Right' });
    expect(a.flexion.index).toBeCloseTo(60, 3);
    expect(fingerFlexionSum(a.angles, 'middle')).toBeCloseTo(60, 3);
    expect(a.dims?.palmLength).toBeGreaterThan(0);
  });

  it('returns an all-null analysis for missing tracking data', () => {
    const a = analyzeFrame(null);
    expect(a.openness).toBeNull();
    expect(a.angles.index_pip).toBeNull();
    expect(a.flexion.thumb).toBeNull();
    const b = analyzeFrame({ world: [], handedness: 'Left' });
    expect(b.palm).toBeNull();
  });
});

describe('range of motion', () => {
  it('computes min, max, amplitude and robust amplitude, skipping nulls', () => {
    const r = computeRange([10, null, 20, NaN, 70, 40])!;
    expect(r.min).toBe(10);
    expect(r.max).toBe(70);
    expect(r.amplitude).toBe(60);
    expect(r.count).toBe(4);
    expect(r.robustAmplitude).toBeLessThanOrEqual(60);
    expect(computeRange([null, null])).toBeNull();
    expect(computeRange([1, 2], 3)).toBeNull();
  });

  it('ignores single-frame outliers in the robust amplitude', () => {
    const series = Array.from({ length: 100 }, (_, i) => 20 + (i % 10));
    series[50] = 400;
    const r = computeRange(series)!;
    expect(r.amplitude).toBeGreaterThan(300);
    expect(r.robustAmplitude).toBeLessThan(15);
  });

  it('tracks live ranges per joint', () => {
    const t = new RangeTracker<'a' | 'b'>();
    t.update({ a: 5, b: null });
    t.update({ a: 25, b: 3 });
    t.update({ a: -5 });
    expect(t.get('a')).toMatchObject({ min: -5, max: 25, amplitude: 30, count: 3 });
    expect(t.get('b')).toMatchObject({ min: 3, max: 3, amplitude: 0 });
    t.reset();
    expect(t.get('a')).toBeNull();
  });

  it('computes percentiles and means safely', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([], 50)).toBeNull();
    expect(mean([null, undefined])).toBeNull();
  });
});
