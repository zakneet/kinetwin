import type { ReactNode } from 'react';

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ');
}

export function Section({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('border-b border-line px-5 py-4', className)}>
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-display text-[13px] font-semibold tracking-[0.01em] text-ink">{title}</h3>
        {aside && <div className="text-[12px] text-muted">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-black/20 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-md font-medium transition-colors',
            size === 'sm' ? 'px-2 py-1 text-[12px]' : 'px-3 py-1.5 text-[13px]',
            value === o.value ? 'bg-white/10 text-ink shadow-[inset_0_0_0_1px_rgb(62_230_210/0.35)]' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function IconToggle({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cx(
        'grid h-9 w-9 place-items-center rounded-lg transition-colors',
        active ? 'bg-turq/15 text-turq shadow-[inset_0_0_0_1px_rgb(62_230_210/0.4)]' : 'text-muted hover:bg-white/5 hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

export function Button({
  children,
  onClick,
  variant = 'ghost',
  disabled,
  title,
  className,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger' | 'record';
  disabled?: boolean;
  title?: string;
  className?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors disabled:opacity-40',
        variant === 'primary' && 'bg-turq text-[#04201c] hover:bg-[#5cf0de]',
        variant === 'ghost' && 'border border-line-strong text-ink hover:bg-white/5',
        variant === 'danger' && 'border border-coral/40 text-coral hover:bg-coral/10',
        variant === 'record' && 'bg-coral text-[#2a0710] hover:bg-[#ff95a2]',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Horizontal meter. The track is a lighter step of the fill hue. */
export function Meter({ value, max = 1, color = 'var(--color-turq)', marker }: { value: number | null; max?: number; color?: string; marker?: number | null }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(1, value / max)) * 100;
  const mk = marker === null || marker === undefined ? null : Math.max(0, Math.min(1, marker / max)) * 100;
  return (
    <div className="relative h-1.5 w-full rounded-full" style={{ background: `color-mix(in oklab, ${color} 16%, transparent)` }}>
      <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-150" style={{ width: `${pct}%`, background: value === null ? 'transparent' : color }} />
      {mk !== null && <div className="absolute -top-1 h-3.5 w-[2px] rounded bg-violet" style={{ left: `calc(${mk}% - 1px)` }} title="Personal baseline" />}
    </div>
  );
}

export function fmt(v: number | null | undefined, digits = 0, unit = ''): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}${unit}`;
}

export function fmtSigned(v: number | null | undefined, digits = 0, unit = ''): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = v.toFixed(digits);
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${s.replace('-', '')}${unit}`;
}

export function fmtTime(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, '0')}`;
}

export function EstimateNote({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[11.5px] leading-snug text-faint">{children}</p>;
}
