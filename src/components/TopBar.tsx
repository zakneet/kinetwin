import { Camera, CameraOff, ShieldCheck } from 'lucide-react';
import { appStore, type View } from '../state/appStore';
import { useStore } from '../state/store';
import { engine, trackingStore } from '../tracking/engine';
import { cx } from './ui';
import { TrackingPill } from './TrackingPill';

const NAV: { id: View; label: string }[] = [
  { id: 'live', label: 'Live twin' },
  { id: 'assessment', label: 'Assessment' },
  { id: 'sessions', label: 'Sessions' },
];

export function TopBar() {
  const view = useStore(appStore, (s) => s.view);
  const status = useStore(trackingStore, (s) => s.status);
  const active = status === 'running' || status === 'loading-model' || status === 'requesting-camera';
  return (
    <header className="relative z-20 flex h-16 shrink-0 items-center gap-6 border-b border-line px-5">
      <div className="flex min-w-0 items-center gap-3">
        <svg width="30" height="30" viewBox="0 0 64 64" aria-hidden className="shrink-0">
          <path d="M20 46c-3-6-4-12-2-19M27 44V17M34 44V14M41 44V18M47 45c2-6 3-11 2-17" stroke="#3EE6D2" strokeWidth="4" strokeLinecap="round" fill="none" />
          <circle cx="27" cy="31" r="3" fill="#8F7CFF" />
          <circle cx="34" cy="28" r="3" fill="#8F7CFF" />
          <circle cx="41" cy="31" r="3" fill="#8F7CFF" />
        </svg>
        <div className="min-w-0 leading-none">
          <div className="font-display text-[17px] font-bold tracking-[0.34em] text-ink">KINETWIN</div>
          <div className="mt-1.5 truncate text-[9.5px] font-medium tracking-[0.2em] text-muted">REAL-TIME HAND BIOMECHANICS DIGITAL TWIN</div>
        </div>
      </div>

      <nav aria-label="Sections" className="mx-auto flex items-center gap-1 rounded-xl border border-line bg-black/25 p-1">
        {NAV.map((n) => (
          <button
            key={n.id}
            onClick={() => appStore.set({ view: n.id })}
            aria-current={view === n.id ? 'page' : undefined}
            className={cx(
              'relative rounded-lg px-4 py-1.5 font-display text-[13px] font-medium transition-colors',
              view === n.id ? 'bg-white/[0.08] text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {n.label}
            {view === n.id && <span className="absolute inset-x-4 -bottom-[5px] h-[2px] rounded-full bg-turq" />}
          </button>
        ))}
      </nav>

      <div className="flex items-center gap-3">
        <TrackingPill />
        <span className="hidden items-center gap-1.5 text-[12px] text-muted xl:flex" title="Camera frames are processed in this browser tab and never uploaded or recorded.">
          <ShieldCheck size={15} className="text-turq" /> On-device
        </span>
        <button
          onClick={() => (active ? engine.stop() : void engine.start())}
          className={cx(
            'inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors',
            active ? 'border border-line-strong text-ink hover:bg-white/5' : 'bg-turq text-[#04201c] hover:bg-[#5cf0de]',
          )}
        >
          {active ? <CameraOff size={16} /> : <Camera size={16} />}
          {active ? 'Stop camera' : 'Start camera'}
        </button>
      </div>
    </header>
  );
}
