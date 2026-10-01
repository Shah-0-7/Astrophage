/**
 * ============================================================
 * DataChart – Recharts Area Chart
 * ============================================================
 * Renders time-series metrics with gradient fills and
 * animated transitions matching the category accent color.
 * ============================================================
 */

'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

interface ChartProps {
  data: { date: string; value: number; label?: string }[];
  color: string;
  unit: string;
}

export default function DataChart({ data, color, unit }: ChartProps) {
  if (data.length === 0) {
    return (
      <div className="h-[140px] flex items-center justify-center text-xs text-[var(--text-muted)]">
        No data yet — advance the timeline
      </div>
    );
  }

  const gradientId = `chart-gradient-${color.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <ResponsiveContainer width="100%" height={140}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <CartesianGrid
          strokeDasharray="3 3"
          stroke="rgba(255,255,255,0.04)"
          vertical={false}
        />

        <XAxis
          dataKey="date"
          tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(val: string) => {
            const d = new Date(val);
            return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
          }}
          interval="preserveStartEnd"
          minTickGap={40}
        />

        <YAxis
          tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
          tickLine={false}
          axisLine={false}
          width={40}
        />

        <Tooltip
          contentStyle={{
            background: 'rgba(18, 18, 26, 0.9)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            fontSize: '11px',
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-primary)',
            backdropFilter: 'blur(8px)',
          }}
          labelFormatter={(val) => {
            const d = new Date(String(val));
            return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
          }}
          formatter={(value) => [`${Number(value ?? 0)} ${unit}`, 'Value']}
        />

        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{
            r: 4,
            stroke: color,
            strokeWidth: 2,
            fill: 'var(--bg-primary)',
          }}
          isAnimationActive={true}
          animationDuration={600}
          animationEasing="ease-in-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
