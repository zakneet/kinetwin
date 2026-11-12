import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { FINGER_JOINTS, JOINT_BY_ID, type JointId } from '../lib/angles';
import type { Baseline } from '../lib/calibration';
import { angularVelocity, checkSampling } from '../lib/kinematics';
import { FINGERS, FINGER_LABEL, LONG_FINGERS, type FingerName } from '../lib/landmarks';
import type { FrameAnalysis } from '../lib/analysis';
import { CLOSE_APPROACH } from '../lib/assessment';
import { appStore } from '../state/appStore';
import { jointIndex, liveHistory, useHistoryTick } from '../state/history';
import { useStore } from '../state/store';
import { AngleTimeline } from './charts';
import { EstimateNote, Meter, Section, Segmented, fmt, fmtSigned } from './ui';

export function OpennessReadout({ analysis, baseline, handedness }: { analysis: FrameAnalysis | null; baseline: Baseline | null; handedness: string | null }) {
  const o = analysis?.openness ?? null;
  return (
    <Section title="Hand openness" aside={handedness ? `${handedness} hand` : 'No hand'}>
      <div className="flex items-end gap-4">
        <div className="num font-display text-[34px] font-semibold leading-none">{o === null ? '—' : Math.round(o * 100)}</div>
        <div className="flex-1 pb-1.5">
          <Meter value={o} marker={baseline?.openness ?? null} />
          <div className="mt-1.5 flex justify-between text-[10.5px] text-faint">
            <span>Closed</span>
            <span>Open</span>
          </div>
        </div>
      </div>
      <EstimateNote>
        App-defined index (0–100) from finger flexion and straightness — not a clinical score.
        {baseline && ' Violet tick: your calibrated open hand.'}
      </EstimateNote>
    </Section>
  );
}

export function OppositionReadout({ analysis }: { analysis: FrameAnalysis | null }) {
  useHistoryTick(6);
  return (
    <Section title="Thumb opposition" aside="tip distance ÷ palm length">
      <div className="space-y-2.5">
        {LONG_FINGERS.map((f) => {
          const d = analysis?.opposition[f] ?? null;
          const close = d !== null && d <= CLOSE_APPROACH;
          return (
            <div key={f} className="grid grid-cols-[52px_1fr_44px] items-center gap-3">
              <span className="text-[12px] text-muted">{FINGER_LABEL[f]}</span>
              <div className="relative h-1.5 rounded-full bg-turq/15">
                {/* closeness: full bar = touching, empty = ≥ 1.6 palm lengths apart */}
                <div className="absolute inset-y-0 left-0 rounded-full bg-turq transition-[width] duration-150" style={{ width: d === null ? 0 : `${Math.max(0, 1 - d / 1.6) * 100}%` }} />
                <div className="absolute -top-1 h-3.5 w-px bg-ink/40" style={{ left: `${(1 - CLOSE_APPROACH / 1.6) * 100}%` }} title="Close-approach threshold" />
              </div>
              <span className={`num text-right text-[12.5px] font-medium ${close ? 'text-turq' : 'text-ink'}`}>{fmt(d, 2)}</span>
            </div>
          );
        })}
      </div>
      <EstimateNote>Longer bar = thumb closer. Tick marks the app-defined close-approach level ({CLOSE_APPROACH} × palm length).</EstimateNote>
    </Section>
  );
}

export function SpreadReadout({ analysis }: { analysis: FrameAnalysis | null }) {
  const s = analysis?.spread;
  const rows: [string, number | null | undefined][] = [
    ['Thumb–index', s?.thumbIndex],
    ['Index–middle', s?.indexMiddle],
    ['Middle–ring', s?.middleRing],
    ['Ring–little', s?.ringLittle],
  ];
  return (
    <Section title="Finger spread" aside={`total ${fmt(s?.totalLong ?? null, 0, '°')}`}>
      <div className="grid grid-cols-4 gap-2">
        {rows.map(([k, v]) => (
          <div key={k} className="rounded-lg bg-white/[0.03] px-2 py-2 text-center">
            <div className="num font-display text-[16px] font-semibold">{fmt(v ?? null, 0, '°')}</div>
            <div className="mt-0.5 text-[10.5px] leading-tight text-faint">{k}</div>
          </div>
        ))}
      </div>
      <EstimateNote>Angles between proximal phalanges projected on the palm plane (abduction proxy).</EstimateNote>
    </Section>
  );
}

/** Live timeline + angular velocity for one finger. */
export function FingerTimeline() {
  const selected = useStore(appStore, (s) => s.selectedJoint);
  const [finger, setFinger] = useState<FingerName>('index');
  const activeFinger = selected ? JOINT_BY_ID[selected].finger : finger;
  const tick = useHistoryTick(8);

  const { data, velocity, sampling } = useMemo(() => {
    void tick;
    const pts = liveHistory.points;
    const ids = FINGER_JOINTS[activeFinger] as readonly JointId[];
    const idx = ids.map(jointIndex);
    const now = pts.length ? pts[pts.length - 1].t : 0;
    const recent = pts.filter((p) => now - p.t <= 10000);
    const data = recent.map((p) => ({
      t: (p.t - now) / 1000,
      [ids[0]]: p.a[idx[0]],
      [ids[1]]: p.a[idx[1]],
      [ids[2]]: p.a[idx[2]],
    }));
    const last = pts.filter((p) => now - p.t <= 1000);
    const times = last.map((p) => p.t);
    const sampling = checkSampling(times);
    const fi = FINGERS.indexOf(activeFinger);
    const vel = sampling.ok ? angularVelocity(times, last.map((p) => p.f[fi])) : [];
    const finite = vel.filter((v): v is number => v !== null);
    const velocity = finite.length ? finite[finite.length - 1] : null;
    return { data, velocity, sampling };
  }, [tick, activeFinger]);

  const ids = FINGER_JOINTS[activeFinger];
  return (
    <Section
      title="Joint-angle timeline"
      aside={
        <Segmented
          size="sm"
          label="Finger"
          value={activeFinger}
          onChange={(f) => {
            setFinger(f);
            if (selected) appStore.set({ selectedJoint: null });
          }}
          options={FINGERS.map((f) => ({ value: f, label: FINGER_LABEL[f].slice(0, 1), title: FINGER_LABEL[f] }))}
        />
      }
    >
      <AngleTimeline
        data={data}
        series={ids.map((id) => ({ key: id, label: `${JOINT_BY_ID[id].kind}${JOINT_BY_ID[id].approximate ? ' ≈' : ''}` }))}
        xFormatter={(v) => `${v.toFixed(0)} s`}
        domain={[activeFinger === 'thumb' ? 0 : -30, 'auto']}
        height={150}
      />
      <div className="mt-3 flex items-baseline justify-between text-[12px]">
        <span className="text-muted">{FINGER_LABEL[activeFinger]} flexion velocity</span>
        <span className="num font-medium">
          {sampling.ok ? fmtSigned(velocity, 0, ' °/s') : <span className="text-amber">{sampling.reason ?? 'insufficient sampling'}</span>}
        </span>
      </div>
      <EstimateNote>Velocity is reported only when sampling is ≥ 15 Hz without gaps. Landmark jitter is not tremor.</EstimateNote>
    </Section>
  );
}

/** Observed range of motion since the last reset, per finger, relative to the personal baseline. */
export function RomPanel({ baseline }: { baseline: Baseline | null }) {
  const tick = useHistoryTick(4);
  void tick;
  const rom = liveHistory.rom;
  const since = Math.round((performance.now() - liveHistory.romSince) / 1000);
  const scaleMax = 300;
  return (
    <Section
      title="Observed range of motion"
      aside={
        <button onClick={() => liveHistory.resetRom()} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink" title="Reset observed ranges">
          <RotateCcw size={12} /> {since}s
        </button>
      }
    >
      <div className="space-y-3">
        {FINGERS.map((f) => {
          const r = rom.get(`flex_${f}`);
          const baseSum = baseline
            ? FINGER_JOINTS[f].filter((id) => id !== 'thumb_cmc').reduce<number | null>((acc, id) => {
                const v = baseline.jointAngles[id];
                return acc === null || v === null ? null : acc + (id.endsWith('_mcp') && f !== 'thumb' ? Math.max(0, v) : v);
              }, 0)
            : null;
          const left = r ? (Math.max(0, r.min) / scaleMax) * 100 : 0;
          const width = r ? (Math.max(0, r.max - Math.max(0, r.min)) / scaleMax) * 100 : 0;
          return (
            <div key={f}>
              <div className="mb-1 flex items-baseline justify-between text-[12px]">
                <span className="text-muted">{FINGER_LABEL[f]}</span>
                <span className="num text-ink">
                  {r ? `${r.min.toFixed(0)}° – ${r.max.toFixed(0)}°` : '—'}
                  <span className="ml-2 text-faint">{r ? `Δ ${r.amplitude.toFixed(0)}°` : ''}</span>
                </span>
              </div>
              <div className="relative h-2 rounded-full bg-azure/15">
                {r && <div className="absolute inset-y-0 rounded-full bg-azure" style={{ left: `${left}%`, width: `${Math.max(1, width)}%` }} />}
                {baseSum !== null && <div className="absolute -top-1 h-4 w-[2px] rounded bg-violet" style={{ left: `${(Math.max(0, baseSum) / scaleMax) * 100}%` }} title="Baseline (calibrated open hand)" />}
              </div>
            </div>
          );
        })}
      </div>
      <EstimateNote>Total estimated flexion per finger (MCP + PIP + DIP; thumb MCP + IP), 0–300° scale. Move through your full range to fill it.</EstimateNote>
    </Section>
  );
}
