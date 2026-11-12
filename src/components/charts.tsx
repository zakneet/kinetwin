import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ReactNode } from 'react';

/**
 * Chart palette validated with the dataviz validator against the dark
 * surface #0a1222 (lightness band, chroma, CVD ΔE 17.2, normal-vision ΔE 24, contrast).
 * Fixed order — never cycled.
 */
export const SERIES = ['#1ea595', '#8f7cff', '#cc7b40'] as const;
export const GRID = 'rgb(148 178 220 / 0.10)';
export const AXIS_TEXT = '#8b98b0';

export const axisProps = {
  stroke: GRID,
  tick: { fill: AXIS_TEXT, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: GRID },
} as const;

export function ChartTooltip({ active, payload, label, labelFormatter, unit = '°' }: {
  active?: boolean;
  payload?: { name?: string; value?: number | null; color?: string; dataKey?: string }[];
  label?: number | string;
  labelFormatter?: (l: number | string) => ReactNode;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-strong rounded-lg px-3 py-2 text-[12px] shadow-xl">
      <div className="mb-1 text-muted">{labelFormatter && label !== undefined ? labelFormatter(label) : label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="h-[2px] w-3 rounded" style={{ background: p.color }} />
          <span className="text-muted">{p.name}</span>
          <span className="num ml-auto font-medium text-ink">{p.value === null || p.value === undefined ? '—' : `${Number(p.value).toFixed(1)}${unit}`}</span>
        </div>
      ))}
    </div>
  );
}

export function LegendRow({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="h-[2px] w-3.5 rounded" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export interface SeriesDef {
  key: string;
  label: string;
}

/** Multi-series angle timeline (≤ 3 series, single y-axis in degrees). */
export function AngleTimeline({
  data,
  series,
  height = 160,
  xKey = 't',
  xFormatter,
  domain = [0, 'auto'],
}: {
  data: Record<string, number | null>[];
  series: SeriesDef[];
  height?: number;
  xKey?: string;
  xFormatter?: (v: number) => string;
  domain?: [number | 'auto', number | 'auto'];
}) {
  return (
    <div>
      <LegendRow items={series.map((s, i) => ({ label: s.label, color: SERIES[i] }))} />
      <div style={{ height }} className="mt-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey={xKey} type="number" domain={['dataMin', 'dataMax']} tickFormatter={xFormatter} {...axisProps} minTickGap={28} />
            <YAxis domain={domain} {...axisProps} width={44} tickFormatter={(v: number) => `${Math.round(v)}°`} />
            <Tooltip
              content={<ChartTooltip labelFormatter={(l) => (xFormatter ? xFormatter(Number(l)) : String(l))} />}
              cursor={{ stroke: 'rgb(230 238 248 / 0.25)', strokeWidth: 1 }}
              isAnimationActive={false}
            />
            <Legend content={() => null} />
            {series.map((s, i) => (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.label}
                type="monotone"
                stroke={SERIES[i]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: '#0a1222', strokeWidth: 2 }}
                isAnimationActive={false}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
