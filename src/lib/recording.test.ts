import { describe, expect, it } from 'vitest';
import { analyzeFrame } from './analysis';
import { computeBaseline, deltaFromBaseline, type CalibrationSample } from './calibration';
import { compareSessions, normalizedJointSeries } from './compare';
import { decodeFrame, findFrameIndex, parseSession, sampleSession, serializeSession, SessionRecorder, summarizeSession, type Session } from './recording';
import { computeOpenClose, computeOppositionStep, stepValidity, toAssessmentSample, trackingCoverage } from './assessment';
import { syntheticFrame } from './__fixtures__/syntheticHand';

function record(poses: number[], dt = 33, handedness: 'Left' | 'Right' = 'Right'): Session {
  const rec = new SessionRecorder();
  rec.start(1000, { exerciseType: 'open-close', calibration: null });
  poses.forEach((k, i) => {
    const f = syntheticFrame({ handedness, all: { mcp: 80 * k, pip: 95 * k, dip: 60 * k } }, 1000 + i * dt);
    rec.addFrame(f, analyzeFrame(f), 1000 + i * dt);
  });
  return rec.stop(1000 + poses.length * dt, new Date('2026-01-01T10:00:00Z'))!;
}

describe('session recorder', () => {
  it('records frames with timestamps relative to start and excludes paused time', () => {
    const rec = new SessionRecorder();
    const f = syntheticFrame();
    const a = analyzeFrame(f);
    rec.start(100, { exerciseType: 'free', calibration: null });
    expect(rec.addFrame(f, a, 150)).toBe(true);
    rec.pause(200);
    expect(rec.addFrame(f, a, 250)).toBe(false); // ignored while paused
    rec.resume(1200); // 1000 ms paused
    expect(rec.addFrame(f, a, 1250)).toBe(true);
    const s = rec.stop(1300)!;
    expect(s.frames.map((x) => x.t)).toEqual([50, 150]);
    expect(s.durationMs).toBe(200);
    expect(s.events.map((e) => e.type)).toEqual(['pause', 'resume']);
    expect(s.handedness).toBe('Right');
    expect(s.frames[0].a).toHaveLength(15);
  });

  it('produces no session when nothing was tracked', () => {
    const rec = new SessionRecorder();
    rec.start(0, { exerciseType: 'free', calibration: null });
    expect(rec.stop(5000)).toBeNull();
    expect(new SessionRecorder().stop(10)).toBeNull();
  });

  it('flags sessions that contain both hands', () => {
    const rec = new SessionRecorder();
    rec.start(0, { exerciseType: 'free', calibration: null });
    const r = syntheticFrame({ handedness: 'Right' });
    const l = syntheticFrame({ handedness: 'Left' });
    rec.addFrame(r, analyzeFrame(r), 10);
    rec.addFrame(l, analyzeFrame(l), 20);
    expect(rec.stop(30)!.handedness).toBe('Mixed');
  });
});

describe('serialization', () => {
  it('round-trips through JSON without losing landmarks or measurements', () => {
    const s = record([0, 0.5, 1, 0.5, 0]);
    const parsed = parseSession(serializeSession(s));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.droppedFrames).toBe(0);
    expect(parsed.session.frames).toEqual(s.frames);
    expect(parsed.session.exerciseType).toBe('open-close');
    const f = decodeFrame(parsed.session.frames[2])!;
    expect(f.world).toHaveLength(21);
    expect(f.handedness).toBe('Right');
  });

  it('rejects invalid files with a clear error', () => {
    expect(parseSession('{not json')).toEqual({ ok: false, error: 'File is not valid JSON' });
    expect(parseSession({ schema: 'other' })).toMatchObject({ ok: false });
    expect(parseSession({ schema: 'kinetwin.session', version: 2, frames: [] })).toMatchObject({ ok: false });
    expect(parseSession({ schema: 'kinetwin.session', version: 1, frames: [] })).toMatchObject({ ok: false, error: 'Session contains no valid landmark frames' });
  });

  it('drops corrupted frames and keeps the valid ones', () => {
    const s = record([0, 0.2, 0.4]);
    const raw = JSON.parse(serializeSession(s));
    raw.frames[1].wlm[5] = null; // corrupted landmark
    raw.frames.push({ t: 'x' });
    const parsed = parseSession(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.droppedFrames).toBe(2);
      expect(parsed.session.frames).toHaveLength(2);
    }
  });
});

describe('replay interpolation', () => {
  const s = record([0, 1], 100);

  it('finds the bracketing frame', () => {
    expect(findFrameIndex(s.frames, -5)).toBe(-1);
    expect(findFrameIndex(s.frames, 0)).toBe(0);
    expect(findFrameIndex(s.frames, 50)).toBe(0);
    expect(findFrameIndex(s.frames, 100)).toBe(1);
  });

  it('linearly interpolates landmarks between recorded frames', () => {
    const a = decodeFrame(s.frames[0])!;
    const b = decodeFrame(s.frames[1])!;
    const mid = sampleSession(s.frames, 50).frame!;
    for (const i of [0, 8, 12, 20]) {
      expect(mid.world[i].x).toBeCloseTo((a.world[i].x + b.world[i].x) / 2, 6);
      expect(mid.world[i].z).toBeCloseTo((a.world[i].z + b.world[i].z) / 2, 6);
      expect(mid.landmarks[i].y).toBeCloseTo((a.landmarks[i].y + b.landmarks[i].y) / 2, 6);
    }
    expect(mid.t).toBe(50);
  });

  it('interpolated poses produce intermediate joint angles', () => {
    const mid = sampleSession(s.frames, 50).frame!;
    const pip = analyzeFrame(mid).angles.index_pip!;
    expect(pip).toBeGreaterThan(10);
    expect(pip).toBeLessThan(95);
  });

  it('does not invent frames inside tracking gaps or outside the recording', () => {
    const gappy = { ...s, frames: [s.frames[0], { ...s.frames[1], t: 2000 }] };
    const r = sampleSession(gappy.frames, 1000);
    expect(r.frame).toBeNull();
    expect(r.gap).toBe(true);
    expect(sampleSession(s.frames, -10).frame).toBeNull();
    expect(sampleSession(s.frames, 5000).frame).toBeNull();
    expect(sampleSession([], 0).frame).toBeNull();
    expect(sampleSession(s.frames, NaN).frame).toBeNull();
  });
});

describe('session summary and comparison', () => {
  it('summarises ranges of motion', () => {
    const s = record([0, 0.25, 0.5, 0.75, 1, 0.75, 0.5]);
    const sum = summarizeSession(s);
    expect(sum.frameCount).toBe(7);
    expect(sum.joints.index_pip!.max).toBeCloseTo(95, 0);
    expect(sum.joints.index_pip!.min).toBeCloseTo(0, 1);
    expect(sum.openness!.amplitude).toBeGreaterThan(0.7);
  });

  it('compares amplitude, duration and handedness between sessions', () => {
    const small = record([0, 0.3, 0.5, 0.3, 0], 33, 'Left');
    const large = record([0, 0.5, 1, 0.5, 0, 0.5, 1], 33, 'Right');
    const c = compareSessions(small, large);
    expect(c.leftRight).toBe(true);
    const pip = c.jointAmplitude.find((r) => r.key === 'index_pip')!;
    expect(pip.diff!).toBeGreaterThan(40);
    const dur = c.general.find((r) => r.key === 'duration')!;
    expect(dur.b!).toBeGreaterThan(dur.a!);
    expect(normalizedJointSeries(large, 'index_pip', 10)).toHaveLength(10);
  });
});

describe('calibration baseline', () => {
  const samples = (n: number, jitter: number, pose = 0.05): CalibrationSample[] =>
    Array.from({ length: n }, (_, i) => {
      const f = syntheticFrame({ all: { mcp: 5 + jitter * Math.sin(i), pip: 8 * pose * 10, dip: 4 } });
      return { t: i * 33, handedness: 'Right', score: 0.95, analysis: analyzeFrame(f) };
    });

  it('builds a baseline from a stable open hand', () => {
    const r = computeBaseline(samples(40, 0.5), undefined, new Date('2026-02-02T00:00:00Z'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.baseline.handedness).toBe('Right');
    expect(r.baseline.jointAngles.index_mcp!).toBeCloseTo(5, 0);
    expect(r.baseline.createdAt).toBe('2026-02-02T00:00:00.000Z');
    expect(r.baseline.palmLength!).toBeGreaterThan(0);
    const d = deltaFromBaseline({ ...samples(1, 0)[0].analysis.angles, index_mcp: 25 }, r.baseline);
    expect(d.index_mcp!).toBeCloseTo(20, 0);
  });

  it('rejects unstable, short or closed-hand captures', () => {
    expect(computeBaseline(samples(40, 15)).ok).toBe(false);
    expect(computeBaseline(samples(10, 0)).ok).toBe(false);
    const fist = Array.from({ length: 40 }, (_, i) => {
      const f = syntheticFrame({ all: { mcp: 85, pip: 100, dip: 70 } });
      return { t: i * 33, handedness: 'Right' as const, score: 0.95, analysis: analyzeFrame(f) };
    });
    const r = computeBaseline(fist);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/open/);
  });
});

describe('guided test computations', () => {
  const series = (n: number, fn: (i: number) => number, dt = 33) =>
    Array.from({ length: n }, (_, i) => {
      const k = fn(i);
      const f = syntheticFrame({ all: { mcp: 80 * k, pip: 95 * k, dip: 60 * k } });
      return toAssessmentSample(i * dt, 0.95, analyzeFrame(f));
    });

  it('measures open/close cycles from tracked samples', () => {
    const s = series(300, (i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i * 33) / 2000));
    const r = computeOpenClose(s, 300 * 33);
    expect(r.validity.valid).toBe(true);
    expect(r.cycles.length).toBeGreaterThanOrEqual(4);
    // Cycle = leaving the open posture until it is reached again (hold time at 'open' excluded).
    expect(r.meanCycleSec!).toBeGreaterThan(0.8);
    expect(r.meanCycleSec!).toBeLessThanOrEqual(2);
    expect(r.fingerFlexion.index!.amplitude).toBeGreaterThan(200);
    expect(r.durationConsistency!).toBeGreaterThan(0.8);
  });

  it('reports insufficient tracking instead of a result', () => {
    const s = series(20, () => 0);
    const r = computeOpenClose(s, 10000);
    expect(r.validity.valid).toBe(false);
    expect(r.cycles).toHaveLength(0);
    expect(trackingCoverage(s, 10000)).toBeLessThan(0.1);
    expect(stepValidity([], 1000).valid).toBe(false);
  });

  it('finds the closest thumb approach', () => {
    const s = series(60, () => 0);
    s[30] = { ...s[30], opposition: { ...s[30].opposition, ring: 0.12 } };
    const r = computeOppositionStep('ring', s, 60 * 33);
    expect(r.minDistance).toBeCloseTo(0.12, 6);
    expect(r.timeToMinMs).toBe(30 * 33);
    expect(r.closeApproach).toBe(true);
  });
});
