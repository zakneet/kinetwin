import { useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { appStore } from './state/appStore';
import { refreshSessions } from './state/sessions';
import { useStore } from './state/store';
import { AssessmentView } from './views/AssessmentView';
import { LiveView } from './views/LiveView';
import { SessionsView } from './views/SessionsView';
import { cx } from './components/ui';

function Toast() {
  const toast = useStore(appStore, (s) => s.toast);
  if (!toast) return null;
  return (
    <div
      key={toast.id}
      role="status"
      className={cx(
        'glass-strong rise fixed bottom-14 right-5 z-50 max-w-sm rounded-xl px-4 py-3 text-[13px] shadow-2xl',
        toast.tone === 'error' && 'border-coral/50 text-coral',
        toast.tone === 'warn' && 'border-amber/50 text-amber',
      )}
    >
      {toast.text}
    </div>
  );
}

export default function App() {
  const view = useStore(appStore, (s) => s.view);
  useEffect(() => {
    void refreshSessions();
  }, []);
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="min-h-0 flex-1">
        {view === 'live' && <LiveView />}
        {view === 'assessment' && <AssessmentView />}
        {view === 'sessions' && <SessionsView />}
      </main>
      <footer className="flex h-8 shrink-0 items-center justify-between border-t border-line px-5 text-[11px] text-faint">
        <span>Educational biomedical-engineering prototype. Webcam measurements are estimates — not a medical device, not clinically validated, no diagnosis.</span>
        <span>Video stays in this browser · sessions store landmarks only, locally</span>
      </footer>
      <Toast />
    </div>
  );
}
