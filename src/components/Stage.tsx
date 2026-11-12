import type { ReactNode } from 'react';
import { AlertTriangle, Camera, Compass, FlipHorizontal2, Hand, Loader2, Palette, RotateCcw, Spline, Bone } from 'lucide-react';
import { HandTwin } from '../three/HandTwin';
import { appStore } from '../state/appStore';
import type { FrameHub } from '../state/frameHub';
import { useStore } from '../state/store';
import { engine, trackingStore } from '../tracking/engine';
import { CameraPreview } from './CameraPreview';
import { Button, IconToggle, cx } from './ui';

export function StageToolbar() {
  const renderMode = useStore(appStore, (s) => s.renderMode);
  const trails = useStore(appStore, (s) => s.showTrails);
  const flex = useStore(appStore, (s) => s.flexionMap);
  const mirror = useStore(appStore, (s) => s.mirror);
  const orientation = useStore(appStore, (s) => s.orientation);
  return (
    <div className="glass flex items-center gap-1 rounded-xl p-1" role="toolbar" aria-label="3D view options">
      <IconToggle active={renderMode === 'surface'} onClick={() => appStore.set({ renderMode: 'surface' })} title="Anatomical surface view">
        <Hand size={17} />
      </IconToggle>
      <IconToggle active={renderMode === 'skeleton'} onClick={() => appStore.set({ renderMode: 'skeleton' })} title="Skeletal / joint view">
        <Bone size={17} />
      </IconToggle>
      <span className="mx-1 h-5 w-px bg-line-strong" />
      <IconToggle active={flex} onClick={() => appStore.set({ flexionMap: !flex })} title="Colour fingers by estimated flexion">
        <Palette size={17} />
      </IconToggle>
      <IconToggle active={trails} onClick={() => appStore.set({ showTrails: !trails })} title="Fingertip motion trails">
        <Spline size={17} />
      </IconToggle>
      <IconToggle active={mirror} onClick={() => appStore.set({ mirror: !mirror })} title="Mirror view (like the camera preview)">
        <FlipHorizontal2 size={17} />
      </IconToggle>
      <IconToggle
        active={orientation === 'anatomical'}
        onClick={() => appStore.set({ orientation: orientation === 'anatomical' ? 'camera' : 'anatomical' })}
        title="Anatomical orientation: palm facing you, wrist rotation removed"
      >
        <Compass size={17} />
      </IconToggle>
      <span className="mx-1 h-5 w-px bg-line-strong" />
      <IconToggle active={false} onClick={() => appStore.set((s) => ({ cameraResetNonce: s.cameraResetNonce + 1 }))} title="Reset 3D camera">
        <RotateCcw size={17} />
      </IconToggle>
    </div>
  );
}

export function TrackingStats() {
  const fps = useStore(trackingStore, (s) => s.fps);
  const inf = useStore(trackingStore, (s) => s.inferenceMs);
  const delegate = useStore(trackingStore, (s) => s.delegate);
  const score = useStore(trackingStore, (s) => s.score);
  const cont = useStore(trackingStore, (s) => s.continuity);
  const items: [string, string][] = [
    ['Rate', `${fps} Hz`],
    ['Inference', `${inf.toFixed(1)} ms`],
    ['Delegate', delegate ?? '—'],
    ['Handedness score', score ? score.toFixed(2) : '—'],
    ['Continuity (2 s)', `${Math.round(cont * 100)} %`],
  ];
  return (
    <dl className="grid grid-cols-5 gap-x-3 text-[10.5px] leading-tight">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="truncate text-faint">{k}</dt>
          <dd className="num truncate font-medium text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function CameraInset() {
  const status = useStore(trackingStore, (s) => s.status);
  if (status !== 'running') return null;
  return (
    <div className="glass absolute left-4 top-4 z-10 w-[300px] overflow-hidden rounded-xl">
      <div className="relative aspect-video bg-black/40">
        <CameraPreview className="absolute inset-0 h-full w-full" />
        <span className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10.5px] text-ink/90">Mirrored preview · not recorded</span>
      </div>
      <div className="border-t border-line px-3 py-2">
        <TrackingStats />
      </div>
    </div>
  );
}

function StageMessage({ handHints }: { handHints: boolean }) {
  const status = useStore(trackingStore, (s) => s.status);
  const progress = useStore(trackingStore, (s) => s.progress);
  const error = useStore(trackingStore, (s) => s.error);
  const hand = useStore(trackingStore, (s) => s.handState);

  if (status === 'idle') {
    return (
      <div className="pointer-events-auto glass-strong rise max-w-[420px] rounded-2xl p-6 text-center">
        <Camera className="mx-auto mb-3 text-turq" size={26} />
        <h2 className="font-display text-[18px] font-semibold">Start the camera to drive the twin</h2>
        <p className="mt-2 text-[13px] text-muted">
          Hold one hand 40–70 cm from the webcam. Landmarks are computed in this browser tab; video is never uploaded or saved.
        </p>
        <Button variant="primary" className="mt-4" onClick={() => void engine.start()}>
          <Camera size={16} /> Start camera
        </Button>
      </div>
    );
  }
  if (status === 'requesting-camera' || status === 'loading-model') {
    return (
      <div className="glass-strong rise flex items-center gap-3 rounded-xl px-5 py-3 text-[13px]">
        <Loader2 className="animate-spin text-turq" size={18} />
        {progress || 'Starting…'}
      </div>
    );
  }
  if (status === 'error' && error) {
    return (
      <div className="pointer-events-auto glass-strong rise max-w-[440px] rounded-2xl border-coral/40 p-6 text-center">
        <AlertTriangle className="mx-auto mb-3 text-coral" size={26} />
        <h2 className="font-display text-[17px] font-semibold">{error.title}</h2>
        <p className="mt-2 text-[13px] text-muted">{error.detail}</p>
        <Button variant="primary" className="mt-4" onClick={() => void engine.start()}>
          Try again
        </Button>
      </div>
    );
  }
  if (handHints && status === 'running' && (hand === 'searching' || hand === 'lost')) {
    return (
      <div className={cx('glass-strong rise absolute bottom-28 rounded-xl px-4 py-2.5 text-[13px]', hand === 'lost' ? 'text-coral' : 'text-amber')}>
        {hand === 'lost' ? 'Tracking lost — bring your whole hand back into view' : 'Show one hand to the camera, palm facing it'}
      </div>
    );
  }
  return null;
}

export function Stage({
  hub,
  children,
  live = true,
  compact = false,
  handHints = true,
}: {
  hub: FrameHub;
  children?: ReactNode;
  live?: boolean;
  compact?: boolean;
  handHints?: boolean;
}) {
  return (
    <div className="stage relative h-full min-h-0 overflow-hidden">
      <div className="stage-grid pointer-events-none absolute inset-0" />
      <HandTwin hub={hub} className="absolute inset-0" compact={compact} />
      {live && <CameraInset />}
      <div className="absolute right-4 top-4 z-10">
        <StageToolbar />
      </div>
      {live && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <StageMessage handHints={handHints} />
        </div>
      )}
      {children}
    </div>
  );
}
