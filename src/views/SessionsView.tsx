import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileUp, Pause, Play, RotateCcw, Trash2, X } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AngleTimeline, axisProps, ChartTooltip, GRID, LegendRow, SERIES } from '../components/charts';
import { JointGrid } from '../components/JointGrid';
import { Stage } from '../components/Stage';
import { Button, EstimateNote, Section, Segmented, cx, fmt, fmtSigned, fmtTime } from '../components/ui';
import { JOINT_BY_ID, JOINT_IDS, type JointId } from '../lib/angles';
import { compareSessions, normalizedJointSeries } from '../lib/compare';
import { EXERCISE_LABEL, jointSeries, type Session } from '../lib/recording';
import { getSession, type SessionMeta } from '../lib/storage';
import { replayHub, useHubSample } from '../state/frameHub';
import { closeReplay, loadReplay, pauseReplay, playReplay, replayStore, restartReplay, seekReplay, setReplaySpeed, SPEEDS } from '../state/replay';
import { exportSession, importSessionFile, removeAllSessions, removeSession, sessionsStore } from '../state/sessions';
import { useStore } from '../state/store';

function SessionList({ compareIds, setCompareIds }: { compareIds: [string | null, string | null]; setCompareIds: (v: [string | null, string | null]) => void }) {
  const list = useStore(sessionsStore, (s) => s.list);
  const loaded = useStore(sessionsStore, (s) => s.loaded);
  const error = useStore(sessionsStore, (s) => s.error);
  const activeId = useStore(replayStore, (s) => s.sessionId);
  const fileRef = useRef<HTMLInputElement>(null);

  const toggleCompare = (id: string) => {
    const [a, b] = compareIds;
    if (a === id) return setCompareIds([b, null]);
    if (b === id) return setCompareIds([a, null]);
    if (!a) return setCompareIds([id, b]);
    if (!b) return setCompareIds([a, id]);
    setCompareIds([b, id]);
  };

  return (
    <aside className="flex min-h-0 flex-col border-r border-line bg-[rgb(8_13_26/0.6)]" aria-label="Session history">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="font-display text-[13px] font-semibold">
          Session history <span className="num ml-1 text-muted">{list.length}</span>
        </h2>
        <div className="flex gap-1.5">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importSessionFile(f);
              e.target.value = '';
            }}
          />
          <Button onClick={() => fileRef.current?.click()} title="Import a KineTwin session JSON">
            <FileUp size={14} /> Import
          </Button>
        </div>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
        {error && <p className="px-1 text-[12.5px] text-coral">Local storage unavailable: {error}</p>}
        {loaded && list.length === 0 && !error && (
          <div className="px-2 py-10 text-center text-[13px] text-muted">
            No sessions yet. Record a movement on the Live twin page, or save a guided test, and it will appear here.
          </div>
        )}
        <ul className="space-y-2">
          {list.map((m) => {
            const ci = compareIds.indexOf(m.id);
            return (
              <li key={m.id}>
                <div
                  className={cx(
                    'rounded-xl border px-3 py-2.5 transition-colors',
                    activeId === m.id ? 'border-turq/50 bg-turq/[0.07]' : 'border-line hover:bg-white/[0.03]',
                  )}
                >
                  <button className="block w-full text-left" onClick={() => void loadReplay(m.id)} title="Open in replay">
                    <div className="truncate text-[13px] font-medium">{m.name}</div>
                    <div className="num mt-0.5 text-[11.5px] text-muted">
                      {EXERCISE_LABEL[m.exerciseType]} · {m.handedness ?? '—'} · {fmtTime(m.durationMs)} · {m.frameCount} fr
                    </div>
                    <div className="mt-0.5 text-[11px] text-faint">{new Date(m.createdAt).toLocaleString()}</div>
                  </button>
                  <div className="mt-2 flex items-center gap-1">
                    <button
                      onClick={() => toggleCompare(m.id)}
                      aria-pressed={ci >= 0}
                      className={cx(
                        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px]',
                        ci >= 0 ? 'bg-white/10 text-ink' : 'text-muted hover:bg-white/5 hover:text-ink',
                      )}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: ci === 0 ? SERIES[0] : ci === 1 ? SERIES[1] : 'rgb(148 178 220 / 0.3)' }} />
                      {ci === 0 ? 'Compare A' : ci === 1 ? 'Compare B' : 'Compare'}
                    </button>
                    <button onClick={() => void exportSession(m.id)} className="ml-auto rounded-md p-1.5 text-muted hover:bg-white/5 hover:text-ink" title="Export JSON" aria-label="Export JSON">
                      <Download size={14} />
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Delete “${m.name}”? This permanently removes its landmarks and measurements from this browser.`)) {
                          if (replayStore.get().sessionId === m.id) closeReplay();
                          setCompareIds([compareIds[0] === m.id ? null : compareIds[0], compareIds[1] === m.id ? null : compareIds[1]]);
                          void removeSession(m.id);
                        }
                      }}
                      className="rounded-md p-1.5 text-muted hover:bg-coral/10 hover:text-coral"
                      title="Delete session"
                      aria-label="Delete session"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      {list.length > 0 && (
        <div className="border-t border-line p-3">
          <Button
            variant="danger"
            className="w-full"
            onClick={() => {
              if (window.confirm(`Delete all ${list.length} stored sessions from this browser? This cannot be undone.`)) {
                closeReplay();
                setCompareIds([null, null]);
                void removeAllSessions();
              }
            }}
          >
            <Trash2 size={14} /> Delete all sessions
          </Button>
        </div>
      )}
    </aside>
  );
}

function Transport() {
  const session = useStore(replayStore, (s) => s.session);
  const playing = useStore(replayStore, (s) => s.playing);
  const time = useStore(replayStore, (s) => s.time);
  const duration = useStore(replayStore, (s) => s.duration);
  const speed = useStore(replayStore, (s) => s.speed);
  const gap = useStore(replayStore, (s) => s.gap);
  if (!session) return null;
  return (
    <div className="glass-strong absolute bottom-5 left-1/2 z-10 w-[min(680px,calc(100%-2rem))] -translate-x-1/2 rounded-2xl px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-[12px]">
        <span className="truncate font-medium">{session.name}</span>
        <span className={cx('shrink-0', gap ? 'text-coral' : 'text-muted')}>{gap ? 'Hand not tracked at this moment' : 'Replay · no camera needed'}</span>
      </div>
      <div className="flex items-center gap-3">
        {playing ? (
          <button onClick={pauseReplay} className="grid h-9 w-9 place-items-center rounded-full bg-turq text-[#04201c]" aria-label="Pause replay">
            <Pause size={16} fill="currentColor" />
          </button>
        ) : (
          <button onClick={playReplay} className="grid h-9 w-9 place-items-center rounded-full bg-turq text-[#04201c]" aria-label="Play replay">
            <Play size={16} fill="currentColor" />
          </button>
        )}
        <button onClick={restartReplay} className="grid h-9 w-9 place-items-center rounded-full border border-line-strong hover:bg-white/5" aria-label="Restart replay" title="Restart">
          <RotateCcw size={15} />
        </button>
        <span className="num w-[52px] text-right text-[12px]">{fmtTime(time)}</span>
        <input
          type="range"
          min={0}
          max={duration}
          step={10}
          value={time}
          onChange={(e) => seekReplay(Number(e.target.value))}
          className="min-w-0 flex-1"
          aria-label="Replay position"
        />
        <span className="num w-[52px] text-[12px] text-muted">{fmtTime(duration)}</span>
        <Segmented
          size="sm"
          label="Playback speed"
          value={String(speed)}
          onChange={(v) => setReplaySpeed(Number(v))}
          options={SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }))}
        />
        <button onClick={closeReplay} className="rounded-md p-1.5 text-muted hover:text-ink" aria-label="Close replay" title="Close replay">
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

function SessionDetail() {
  const session = useStore(replayStore, (s) => s.session);
  const time = useStore(replayStore, (s) => s.time);
  const sample = useHubSample(replayHub, 12);
  const [joint, setJoint] = useState<JointId>('index_pip');
  const data = useMemo(() => {
    if (!session) return [];
    return jointSeries(session, joint).map((p) => ({ t: p.t / 1000, v: p.v }));
  }, [session, joint]);

  if (!session) {
    return (
      <Section title="Replay">
        <p className="text-[13px] text-muted">Select a session to replay it on the digital twin. Replay uses the stored landmarks only — the camera is not needed.</p>
      </Section>
    );
  }
  const handed = sample?.frame.handedness ?? null;
  return (
    <>
      <Section title="Replayed joint angles" aside={`${(time / 1000).toFixed(1)} s`}>
        <JointGrid angles={sample?.analysis.angles ?? null} baseline={handed && session.calibration?.handedness === handed ? session.calibration : null} />
      </Section>
      <Section
        title="Joint-angle evolution"
        aside={
          <select value={joint} onChange={(e) => setJoint(e.target.value as JointId)} className="rounded-md border border-line-strong bg-navy px-2 py-1 text-[12px] text-ink" aria-label="Joint">
            {JOINT_IDS.map((id) => (
              <option key={id} value={id}>
                {JOINT_BY_ID[id].label}
                {JOINT_BY_ID[id].approximate ? ' ≈' : ''}
              </option>
            ))}
          </select>
        }
      >
        <AngleTimeline data={data} series={[{ key: 'v', label: JOINT_BY_ID[joint].label }]} xFormatter={(v) => `${v.toFixed(0)} s`} domain={['auto', 'auto']} height={150} />
      </Section>
      <Section title="Session details">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
          {(
            [
              ['Exercise', EXERCISE_LABEL[session.exerciseType]],
              ['Hand', session.handedness ?? '—'],
              ['Duration', fmtTime(session.durationMs)],
              ['Frames', String(session.frames.length)],
              ['Recorded', new Date(session.createdAt).toLocaleString()],
              ['Calibration', session.calibration ? `${session.calibration.handedness}, ${new Date(session.calibration.createdAt).toLocaleDateString()}` : 'none'],
              ['Markers', String(session.events.filter((e) => e.type === 'marker').length)],
              ['Test result', session.testResult ? 'included' : '—'],
            ] as [string, string][]
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-faint">{k}</dt>
              <dd className="num text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <Button className="mt-4 w-full" onClick={() => void exportSession(session.id)}>
          <Download size={14} /> Export session JSON
        </Button>
        <EstimateNote>Exports contain landmarks, estimated angles and metrics only — never video.</EstimateNote>
      </Section>
    </>
  );
}

function useLoadedSessions(ids: [string | null, string | null]) {
  const [sessions, setSessions] = useState<[Session | null, Session | null]>([null, null]);
  useEffect(() => {
    let alive = true;
    void Promise.all(ids.map((id) => (id ? getSession(id) : Promise.resolve(null)))).then((r) => {
      if (alive) setSessions([r[0], r[1]]);
    });
    return () => {
      alive = false;
    };
  }, [ids]);
  return sessions;
}

function CompareRows({ rows, digits = 1 }: { rows: { key: string; label: string; a: number | null; b: number | null; diff: number | null; unit: string }[]; digits?: number }) {
  return (
    <table className="w-full text-[12.5px]">
      <thead className="text-faint">
        <tr>
          <th className="py-1 text-left font-normal">Measure</th>
          <th className="text-right font-normal">
            <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: SERIES[0] }} />A
          </th>
          <th className="text-right font-normal">
            <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: SERIES[1] }} />B
          </th>
          <th className="text-right font-normal">B − A</th>
        </tr>
      </thead>
      <tbody className="num">
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-line">
            <td className="py-1 pr-2 text-muted">{r.label}</td>
            <td className="text-right">{fmt(r.a, r.key === 'frames' ? 0 : digits)}</td>
            <td className="text-right">{fmt(r.b, r.key === 'frames' ? 0 : digits)}</td>
            <td className="text-right font-medium">
              {fmtSigned(r.diff, r.key === 'frames' ? 0 : digits)}
              <span className="ml-0.5 text-faint">{r.unit}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ComparePanel({ ids }: { ids: [string | null, string | null] }) {
  const [a, b] = useLoadedSessions(ids);
  const [joint, setJoint] = useState<JointId>('index_pip');
  const cmp = useMemo(() => (a && b ? compareSessions(a, b) : null), [a, b]);
  const overlay = useMemo(() => {
    if (!a || !b) return [];
    const sa = normalizedJointSeries(a, joint, 120);
    const sb = normalizedJointSeries(b, joint, 120);
    return sa.map((v, i) => ({ t: (i / 119) * 100, a: v, b: sb[i] }));
  }, [a, b, joint]);

  if (!ids[0] || !ids[1]) {
    return (
      <Section title="Compare sessions">
        <p className="text-[13px] text-muted">Mark two sessions with “Compare” in the list (A and B) to compare amplitude, joint-angle evolution and duration side by side.</p>
      </Section>
    );
  }
  if (!a || !b || !cmp) return <Section title="Compare sessions"><p className="text-[13px] text-muted">Loading…</p></Section>;
  const fingerBars = cmp.fingerAmplitude.map((r) => ({ name: r.label, a: r.a, b: r.b }));
  return (
    <>
      <Section title="Compare sessions" aside={cmp.leftRight ? 'left vs right hand' : undefined}>
        <div className="space-y-1.5 text-[12.5px]">
          {[a, b].map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SERIES[i] }} />
              <span className="font-medium">{i === 0 ? 'A' : 'B'}</span>
              <span className="truncate text-muted">
                {s.name} · {s.handedness ?? '—'}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3">
          <CompareRows rows={cmp.general.map((r) => (r.key === 'openness' ? { ...r, a: r.a === null ? null : r.a * 100, b: r.b === null ? null : r.b * 100, diff: r.diff === null ? null : r.diff * 100 } : r))} />
        </div>
      </Section>
      <Section title="Movement amplitude per finger" aside="total flexion range, °">
        <LegendRow items={[{ label: 'A', color: SERIES[0] }, { label: 'B', color: SERIES[1] }]} />
        <div className="mt-2 h-[170px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={fingerBars} margin={{ top: 6, right: 8, bottom: 0, left: -18 }} barGap={2} barCategoryGap="28%">
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="name" {...axisProps} />
              <YAxis {...axisProps} width={44} tickFormatter={(v: number) => `${Math.round(v)}°`} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgb(230 238 248 / 0.04)' }} isAnimationActive={false} />
              <Bar dataKey="a" name="A" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
              <Bar dataKey="b" name="B" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>
      <Section
        title="Joint-angle evolution"
        aside={
          <select value={joint} onChange={(e) => setJoint(e.target.value as JointId)} className="rounded-md border border-line-strong bg-navy px-2 py-1 text-[12px] text-ink" aria-label="Joint to compare">
            {JOINT_IDS.map((id) => (
              <option key={id} value={id}>
                {JOINT_BY_ID[id].label}
              </option>
            ))}
          </select>
        }
      >
        <AngleTimeline
          data={overlay}
          series={[
            { key: 'a', label: 'A' },
            { key: 'b', label: 'B' },
          ]}
          xFormatter={(v) => `${Math.round(v)} %`}
          domain={['auto', 'auto']}
          height={160}
        />
        <EstimateNote>Time is normalised to each session's length (0–100 %) so sessions of different duration can be overlaid.</EstimateNote>
      </Section>
      <Section title="Joint range of motion" aside="observed max − min, °">
        <CompareRows rows={cmp.jointAmplitude} digits={0} />
      </Section>
      <Section title="Closest thumb approach" aside="× palm length">
        <CompareRows rows={cmp.opposition} digits={2} />
        <EstimateNote>Differences describe these two recordings only; they are not a measure of clinical change.</EstimateNote>
      </Section>
    </>
  );
}

export function SessionsView() {
  const [tab, setTab] = useState<'replay' | 'compare'>('replay');
  const list = useStore(sessionsStore, (s) => s.list);
  const [compareIds, setCompareIds] = useState<[string | null, string | null]>([null, null]);

  // Default comparison: the two most recent sessions.
  useEffect(() => {
    if (!compareIds[0] && !compareIds[1] && list.length >= 2) setCompareIds([list[1].id, list[0].id]);
  }, [list, compareIds]);

  const metaById = useMemo(() => new Map<string, SessionMeta>(list.map((m) => [m.id, m])), [list]);
  const validIds: [string | null, string | null] = [compareIds[0] && metaById.has(compareIds[0]) ? compareIds[0] : null, compareIds[1] && metaById.has(compareIds[1]) ? compareIds[1] : null];

  return (
    <div className="grid h-full min-h-0 grid-cols-[340px_minmax(0,1fr)_460px]">
      <SessionList compareIds={validIds} setCompareIds={(v) => setCompareIds(v)} />
      <Stage hub={replayHub} live={false}>
        <EmptyReplay />
        <Transport />
      </Stage>
      <aside className="scroll-thin min-h-0 overflow-y-auto border-l border-line bg-[rgb(8_13_26/0.6)]" aria-label="Session analysis">
        <div className="sticky top-0 z-10 border-b border-line bg-[rgb(8_13_26/0.92)] px-5 py-3 backdrop-blur">
          <Segmented
            label="Session panel"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'replay', label: 'Replay analysis' },
              { value: 'compare', label: 'Compare A / B' },
            ]}
          />
        </div>
        {tab === 'replay' ? <SessionDetail /> : <ComparePanel ids={validIds} />}
      </aside>
    </div>
  );
}

function EmptyReplay() {
  const session = useStore(replayStore, (s) => s.session);
  if (session) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
      <div className="glass-strong max-w-[380px] rounded-2xl p-6 text-center">
        <h2 className="font-display text-[17px] font-semibold">Replay a recorded movement</h2>
        <p className="mt-2 text-[13px] text-muted">Choose a session from the history. The twin reproduces the stored landmarks with smooth interpolation, without the camera.</p>
      </div>
    </div>
  );
}
