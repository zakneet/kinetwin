import { ArrowLeftRight, CircleAlert, Play, Square } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { HandGlyph, type GlyphPose } from '../components/HandGlyph';
import { Stage } from '../components/Stage';
import { axisProps, ChartTooltip, GRID, SERIES } from '../components/charts';
import { Button, EstimateNote, Section, cx, fmt } from '../components/ui';
import { CLOSE_APPROACH, MIN_COVERAGE } from '../lib/assessment';
import { MIN_TARGET_AMPLITUDE_DEG } from '../lib/isolation';
import { FINGERS, FINGER_LABEL, type FingerName } from '../lib/landmarks';
import { abortTest, assessmentStore, setRecordTests, startTest, TESTS, type StoredResult, type TestDef, type TestId } from '../state/assessment';
import { liveHub, useHubSample } from '../state/frameHub';
import { recorderStore } from '../state/sessions';
import { useStore } from '../state/store';
import { trackingStore } from '../tracking/engine';

function glyphsFor(test: TestId, finger?: FingerName): [GlyphPose, GlyphPose, FingerName | undefined] {
  switch (test) {
    case 'open-close':
      return ['open', 'fist', undefined];
    case 'finger-isolation':
      return ['open', 'bend', finger ?? 'index'];
    case 'thumb-opposition':
      return ['open', 'pinch', finger ?? 'index'];
    case 'finger-spread':
      return ['open', 'spread', undefined];
  }
}

function Instruction({ def }: { def: TestDef }) {
  const phase = useStore(assessmentStore, (s) => s.phase);
  const running = useStore(assessmentStore, (s) => s.running);
  const stepIndex = useStore(assessmentStore, (s) => s.stepIndex);
  const countdown = useStore(assessmentStore, (s) => s.countdown);
  const progress = useStore(assessmentStore, (s) => s.stepProgress);
  const record = useStore(assessmentStore, (s) => s.record);
  const camRunning = useStore(trackingStore, (s) => s.status === 'running');
  const recBusy = useStore(recorderStore, (s) => s.state !== 'idle');
  const sample = useHubSample(liveHub, 6);
  const isRunning = running === def.id;
  const step = def.steps[Math.min(stepIndex, def.steps.length - 1)];
  const [a, b, hl] = glyphsFor(def.id, isRunning ? step.finger : def.steps[0].finger);

  return (
    <div className="glass-strong absolute bottom-5 left-1/2 z-20 w-[min(560px,calc(100%-2rem))] -translate-x-1/2 rounded-2xl p-5">
      <div className="flex items-start gap-4">
        <div className="flex shrink-0 items-center gap-1 rounded-xl bg-black/25 px-2 py-1">
          <HandGlyph pose={a} highlight={hl} size={58} />
          <ArrowLeftRight size={14} className="text-faint" />
          <HandGlyph pose={b} highlight={hl} size={58} />
        </div>
        <div className="min-w-0 flex-1">
          {!isRunning ? (
            <>
              <h2 className="font-display text-[17px] font-semibold">{def.name}</h2>
              <p className="mt-1 text-[13px] text-muted">{def.summary}</p>
              <p className="mt-1 text-[12px] text-faint">
                {def.steps.length > 1 ? `${def.steps.length} steps · ` : ''}
                {Math.round(def.steps.reduce((s, x) => s + x.durationMs, 0) / 1000)} s of capture
              </p>
            </>
          ) : phase === 'countdown' || phase === 'between' ? (
            <>
              <div className="text-[12px] text-muted">
                {phase === 'countdown' ? 'Get ready' : 'Next'} · step {stepIndex + 1} of {def.steps.length}
              </div>
              <h2 className="mt-0.5 font-display text-[17px] font-semibold">{step.title}</h2>
              <p className="mt-1 text-[13px] text-ink/90">{step.instruction}</p>
              <span key={`${phase}${countdown}`} className="count-in num mt-2 inline-block font-display text-[28px] font-bold text-turq">
                {countdown}
              </span>
            </>
          ) : (
            <>
              <div className="text-[12px] text-muted">
                Step {stepIndex + 1} of {def.steps.length} · capturing
              </div>
              <h2 className="mt-0.5 font-display text-[17px] font-semibold">{step.title}</h2>
              <p className="mt-1 text-[13px] text-ink/90">{step.instruction}</p>
              <div className="mt-3 h-1.5 rounded-full bg-turq/15">
                <div className="h-full rounded-full bg-turq transition-[width] duration-100" style={{ width: `${progress * 100}%` }} />
              </div>
              {!sample && <p className="mt-2 flex items-center gap-1.5 text-[12px] text-amber"><CircleAlert size={13} /> Hand not tracked — this time will count as missing data.</p>}
            </>
          )}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-[12px] text-muted">
          <input type="checkbox" checked={record} disabled={!!running} onChange={(e) => setRecordTests(e.target.checked)} />
          Save landmarks of this test to Sessions
        </label>
        {isRunning ? (
          <Button onClick={abortTest}>
            <Square size={13} /> Stop test
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!camRunning || !!running || recBusy}
            onClick={() => startTest(def.id)}
            title={!camRunning ? 'Start the camera first' : recBusy ? 'Finish the current recording first' : undefined}
          >
            <Play size={14} /> Start test
          </Button>
        )}
      </div>
    </div>
  );
}

function Invalid({ reason }: { reason?: string }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-amber/30 bg-amber/5 px-3 py-2 text-[12.5px] text-amber">
      <CircleAlert size={14} className="mt-0.5 shrink-0" /> {reason ?? 'Not enough valid data'}
    </p>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-3 py-2">
      <div className="num font-display text-[17px] font-semibold">{value}</div>
      <div className="mt-0.5 text-[11px] text-faint">{label}</div>
    </div>
  );
}

function OpenCloseResults({ r }: { r: Extract<StoredResult['data'], { kind: 'open-close' }> }) {
  const res = r.result;
  const data = r.series.map((p) => ({ t: p.t / 1000, o: p.o === null ? null : p.o * 100 }));
  return (
    <>
      {res.reason && <Invalid reason={res.reason} />}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="Complete cycles" value={res.validity.valid ? String(res.cycles.length) : '—'} />
        <Stat label="Mean cycle" value={fmt(res.meanCycleSec, 2, ' s')} />
        <Stat label="Openness range" value={res.opennessRange ? `${Math.round(res.opennessRange.amplitude * 100)}` : '—'} />
        <Stat label="Duration consistency" value={res.durationConsistency === null ? '—' : `${Math.round(res.durationConsistency * 100)} %`} />
        <Stat label="Amplitude consistency" value={res.amplitudeConsistency === null ? '—' : `${Math.round(res.amplitudeConsistency * 100)} %`} />
        <Stat label="Tracking coverage" value={`${Math.round(res.validity.coverage * 100)} %`} />
      </div>
      <h4 className="mt-4 text-[12px] font-medium text-muted">Openness over the test</h4>
      <div className="mt-1 h-[130px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v: number) => `${v.toFixed(0)} s`} {...axisProps} />
            <YAxis domain={[0, 100]} {...axisProps} width={44} />
            {res.thresholds && <ReferenceLine y={res.thresholds.high * 100} stroke="rgb(230 238 248 / 0.25)" />}
            {res.thresholds && <ReferenceLine y={res.thresholds.low * 100} stroke="rgb(230 238 248 / 0.25)" />}
            <Tooltip content={<ChartTooltip unit="" labelFormatter={(l) => `${Number(l).toFixed(1)} s`} />} isAnimationActive={false} />
            <Line dataKey="o" name="Openness" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <h4 className="mt-4 text-[12px] font-medium text-muted">Speed and smoothness (openness signal)</h4>
      {res.movement ? (
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Stat label="Peak speed" value={`${Math.round(res.movement.peakVelocity * 100)} /s`} />
          <Stat label="Smoothness (LDLJ)" value={fmt(res.movement.ldlj, 1)} />
          <Stat label="Speed peaks" value={String(res.movement.speedPeaks)} />
        </div>
      ) : (
        <p className="mt-1 text-[12px] text-amber">Not computed: {res.movementNote ?? 'insufficient sampling'}</p>
      )}
      <h4 className="mt-4 text-[12px] font-medium text-muted">Total finger flexion observed</h4>
      <table className="mt-1 w-full text-[12.5px]">
        <thead className="text-faint">
          <tr>
            <th className="py-1 text-left font-normal">Finger</th>
            <th className="text-right font-normal">Extension (min)</th>
            <th className="text-right font-normal">Flexion (max)</th>
            <th className="text-right font-normal">Range</th>
          </tr>
        </thead>
        <tbody className="num">
          {FINGERS.map((f) => {
            const x = res.fingerFlexion[f];
            return (
              <tr key={f} className="border-t border-line">
                <td className="py-1 text-muted">{FINGER_LABEL[f]}</td>
                <td className="text-right">{fmt(x?.min ?? null, 0, '°')}</td>
                <td className="text-right">{fmt(x?.max ?? null, 0, '°')}</td>
                <td className="text-right font-medium">{fmt(x?.amplitude ?? null, 0, '°')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <EstimateNote>
        Cycles use thresholds at 30 % / 70 % of your own observed openness range. LDLJ: log dimensionless jerk, closer to 0 = smoother. Indicators describe the landmark
        signal only.
      </EstimateNote>
    </>
  );
}

function IsolationResults({ r }: { r: Extract<StoredResult['data'], { kind: 'finger-isolation' }> }) {
  const maxAmp = Math.max(1, ...r.steps.flatMap((s) => FINGERS.map((f) => s.isolation?.amplitudes[f] ?? 0)));
  return (
    <>
      <h4 className="text-[12px] font-medium text-muted">Movement amplitude per finger during each step (°)</h4>
      <table className="mt-2 w-full table-fixed text-[12px]">
        <thead className="text-faint">
          <tr>
            <th className="w-[74px] py-1 text-left font-normal">Target</th>
            {FINGERS.map((f) => (
              <th key={f} className="font-normal">
                {FINGER_LABEL[f].slice(0, 3)}
              </th>
            ))}
            <th className="w-[64px] text-right font-normal">Indep.</th>
          </tr>
        </thead>
        <tbody className="num">
          {r.steps.map((s) => (
            <tr key={s.target} className="border-t border-line">
              <td className="py-1.5 text-muted">{FINGER_LABEL[s.target]}</td>
              {FINGERS.map((f) => {
                const a = s.isolation?.amplitudes[f] ?? null;
                const isT = f === s.target;
                return (
                  <td key={f} className="px-0.5 py-1">
                    <div
                      className={cx('rounded px-1 py-1 text-center', isT && 'shadow-[inset_0_0_0_1px_rgb(62_230_210/0.7)]')}
                      style={{ background: a === null ? 'transparent' : `rgb(30 165 149 / ${0.08 + 0.6 * (a / maxAmp)})` }}
                      title={`${FINGER_LABEL[f]} moved ${a === null ? '—' : a.toFixed(0)}°`}
                    >
                      {a === null ? '—' : a.toFixed(0)}
                    </div>
                  </td>
                );
              })}
              <td className="text-right font-medium">
                {s.isolation?.valid ? `${Math.round((s.isolation.independence ?? 0) * 100)} %` : <span className="text-amber" title={s.isolation?.reason ?? s.validity.reason}>n/a</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="mt-3 space-y-1 text-[12px] text-muted">
        {r.steps.map((s) =>
          s.isolation?.valid ? (
            <li key={s.target}>
              {FINGER_LABEL[s.target]}: other fingers moved {Math.round((s.isolation.unwantedRatio ?? 0) * 100)} % as much as the target; most coupled:{' '}
              {s.isolation.mostCoupled ? FINGER_LABEL[s.isolation.mostCoupled].toLowerCase() : '—'}.
            </li>
          ) : (
            <li key={s.target} className="text-amber">
              {FINGER_LABEL[s.target]}: {s.isolation?.reason ?? s.validity.reason}
            </li>
          ),
        )}
      </ul>
      <EstimateNote>
        Amplitude = 5th–95th percentile span of total finger flexion. Independence = 1 − mean(other long fingers) ÷ target; needs ≥ {MIN_TARGET_AMPLITUDE_DEG}° of
        target movement. Application-defined indicator.
      </EstimateNote>
    </>
  );
}

function OppositionResults({ r }: { r: Extract<StoredResult['data'], { kind: 'thumb-opposition' }> }) {
  return (
    <>
      <div className="space-y-3">
        {r.steps.map((s) => (
          <div key={s.target}>
            <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
              <span className="text-muted">Thumb → {FINGER_LABEL[s.target].toLowerCase()}</span>
              <span className="num">
                {s.validity.valid && s.minDistance !== null ? (
                  <>
                    <span className="font-medium">{s.minDistance.toFixed(2)}</span>
                    <span className="ml-2 text-faint">{s.closeApproach ? 'close approach' : 'not reached'} · {((s.timeToMinMs ?? 0) / 1000).toFixed(1)} s</span>
                  </>
                ) : (
                  <span className="text-amber">{s.validity.reason}</span>
                )}
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-turq/15">
              {s.minDistance !== null && <div className="absolute inset-y-0 left-0 rounded-full bg-turq" style={{ width: `${Math.max(0, 1 - s.minDistance / 1.6) * 100}%` }} />}
              <div className="absolute -top-1 h-4 w-px bg-ink/40" style={{ left: `${(1 - CLOSE_APPROACH / 1.6) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <EstimateNote>
        Closest thumb-tip to fingertip distance divided by palm length (wrist → middle knuckle). Bar = closeness; tick = app-defined close-approach level (
        {CLOSE_APPROACH}). Tip landmarks sit at the finger ends, so a pad-to-pad touch rarely reads 0.
      </EstimateNote>
    </>
  );
}

function SpreadResults({ r }: { r: Extract<StoredResult['data'], { kind: 'finger-spread' }> }) {
  const res = r.result;
  const data = r.series.map((p) => ({ t: p.t / 1000, s: p.s }));
  return (
    <>
      {res.reason && <Invalid reason={res.reason} />}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="Total spread min" value={fmt(res.totalSpread?.min ?? null, 0, '°')} />
        <Stat label="Total spread max" value={fmt(res.totalSpread?.max ?? null, 0, '°')} />
        <Stat label="Spread range" value={fmt(res.totalSpread?.amplitude ?? null, 0, '°')} />
        <Stat label="Tip spread ratio" value={res.tipSpread ? `${res.tipSpread.min.toFixed(2)}–${res.tipSpread.max.toFixed(2)}` : '—'} />
        <Stat label="Thumb–index" value={res.thumbIndex ? `${res.thumbIndex.min.toFixed(0)}–${res.thumbIndex.max.toFixed(0)}°` : '—'} />
        <Stat label="Spread cycles" value={res.validity.valid ? String(res.cycles) : '—'} />
      </div>
      <h4 className="mt-4 text-[12px] font-medium text-muted">Total long-finger spread over the test</h4>
      <div className="mt-1 h-[130px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v: number) => `${v.toFixed(0)} s`} {...axisProps} />
            <YAxis {...axisProps} width={44} tickFormatter={(v: number) => `${Math.round(v)}°`} />
            <Tooltip content={<ChartTooltip labelFormatter={(l) => `${Number(l).toFixed(1)} s`} />} isAnimationActive={false} />
            <Line dataKey="s" name="Total spread" stroke={SERIES[1]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <EstimateNote>Sum of the index–middle, middle–ring and ring–little angles on the palm plane. Tip spread ratio = mean adjacent fingertip gap ÷ palm width.</EstimateNote>
    </>
  );
}

function Results({ test }: { test: TestId }) {
  const stored = useStore(assessmentStore, (s) => s.results[test]);
  if (!stored) {
    return <p className="text-[13px] text-muted">No result yet. Results appear here after the test, computed only from the frames in which your hand was tracked.</p>;
  }
  const d = stored.data;
  return (
    <div>
      <p className="mb-3 text-[12px] text-faint">
        {new Date(stored.completedAt).toLocaleTimeString()} · {stored.handedness ? `${stored.handedness} hand` : 'hand not identified'}
        {stored.recorded ? ' · saved to Sessions' : ''}
      </p>
      {d.kind === 'open-close' && <OpenCloseResults r={d} />}
      {d.kind === 'finger-isolation' && <IsolationResults r={d} />}
      {d.kind === 'thumb-opposition' && <OppositionResults r={d} />}
      {d.kind === 'finger-spread' && <SpreadResults r={d} />}
    </div>
  );
}

export function AssessmentView() {
  const selected = useStore(assessmentStore, (s) => s.selected);
  const running = useStore(assessmentStore, (s) => s.running);
  const results = useStore(assessmentStore, (s) => s.results);
  const def = TESTS.find((t) => t.id === selected)!;

  return (
    <div className="grid h-full min-h-0 grid-cols-[290px_minmax(0,1fr)_440px]">
      <aside className="scroll-thin min-h-0 overflow-y-auto border-r border-line bg-[rgb(8_13_26/0.6)] p-4" aria-label="Guided tests">
        <h2 className="px-1 font-display text-[13px] font-semibold">Guided tests</h2>
        <ol className="mt-3 space-y-2">
          {TESTS.map((t, i) => (
            <li key={t.id}>
              <button
                disabled={!!running}
                onClick={() => assessmentStore.set({ selected: t.id })}
                className={cx(
                  'w-full rounded-xl border px-3 py-3 text-left transition-colors disabled:cursor-not-allowed',
                  selected === t.id ? 'border-turq/50 bg-turq/[0.07]' : 'border-line hover:bg-white/[0.03]',
                )}
              >
                <div className="flex items-baseline gap-2">
                  <span className="num text-[11px] text-faint">Test {i + 1}</span>
                  {results[t.id] && <span className="ml-auto text-[11px] text-turq">result ready</span>}
                </div>
                <div className="mt-0.5 font-display text-[14px] font-semibold">{t.name}</div>
                <div className="mt-1 text-[12px] leading-snug text-muted">{t.summary}</div>
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-5 px-1">
          <h3 className="text-[12px] font-medium text-muted">This test measures</h3>
          <ul className="mt-1.5 space-y-1 text-[12.5px] text-ink/85">
            {def.measures.map((m) => (
              <li key={m} className="flex gap-2">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-turq" />
                {m}
              </li>
            ))}
          </ul>
          <EstimateNote>
            Steps with less than {Math.round(MIN_COVERAGE * 100)} % tracking coverage are reported as invalid instead of producing a number. No normal/abnormal
            classification is made.
          </EstimateNote>
        </div>
      </aside>
      <Stage hub={liveHub} compact handHints={false}>
        <Instruction def={def} />
      </Stage>
      <aside className="scroll-thin min-h-0 overflow-y-auto border-l border-line bg-[rgb(8_13_26/0.6)]" aria-label="Test results">
        <Section title={`Results · ${def.name}`}>
          <Results test={selected} />
        </Section>
      </aside>
    </div>
  );
}
