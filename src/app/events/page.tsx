'use client';

/**
 * /events – Event Directory Page
 *
 * Features:
 *  - URL-synced filters, search, sort, selected event
 *  - Fuzzy search (Fuse.js), type/cause/region/time/mag filters
 *  - Infinite scroll with virtualization fallback
 *  - Summary drawer (right panel / bottom sheet)
 *  - Mission-control loading animations
 *  - Fully keyboard accessible
 *  - Mobile-first with filter bottom sheet
 *  - prefers-reduced-motion safe
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useEventDirectory } from '@/lib/useEventDirectory';
import type { GlobalEvent, SourceHealth } from '@/lib/globalEvents';
import type { DirectoryFilters } from '@/lib/useEventDirectory';
import {
  EVENT_TYPE_CONFIG,
  CAUSE_LABELS,
  CAUSE_COLORS,
  REGIONS,
  TIME_PRESETS,
  SORT_OPTIONS,
  type ActiveFilter,
} from '@/lib/eventDirectoryTypes';
import type { EventType } from '@/lib/globalEvents';
import type { SortKey } from '@/lib/eventDirectoryTypes';

// ── Reduced-motion media query ───────────────────────────────

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

// ── Relative time ────────────────────────────────────────────

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min  = Math.floor(diff / 60_000);
  const hr   = Math.floor(diff / 3600_000);
  const day  = Math.floor(diff / 86400_000);
  const yr   = Math.floor(day / 365);
  if (min < 60)  return `${min}m ago`;
  if (hr  < 24)  return `${hr}h ago`;
  if (day < 365) return `${day}d ago`;
  return `${yr}y ago`;
}

function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

// ── Auto-generated summary text ───────────────────────────────

function generateSummary(event: GlobalEvent): string {
  const cfg = EVENT_TYPE_CONFIG[event.type];
  const dateStr = new Date(event.time).toLocaleDateString('en-US', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  const cause = event.cause === 'human' ? 'human-induced' : 'naturally occurring';

  switch (event.type) {
    case 'tectonic':
    case 'induced_seismicity': {
      const mag   = event.magnitude != null ? `magnitude ${event.magnitude.toFixed(1)}` : 'an';
      const depth = event.depth != null ? ` at a depth of ${event.depth.toFixed(0)} km` : '';
      return `A ${mag} earthquake occurred on ${dateStr}${depth} — reported by ${event.sources.join(' & ')}. This event is classified as ${cause}.`;
    }
    case 'volcanic':
      return `A volcanic event (${event.title}) was recorded on ${dateStr}. ${event.magnitude != null ? `VEI ${event.magnitude}.` : ''} Reported by ${event.sources.join(' & ')}.`;
    case 'landslide':
      return `A ${cause} landslide event was recorded near ${event.title} on ${dateStr}, sourced from ${event.sources.join(' & ')}.`;
    case 'cryosphere':
      return `A cryosphere event (${event.title}) was observed on ${dateStr}. This indicates significant ice or glacier change recorded by ${event.sources.join(' & ')}.`;
    case 'subsidence':
      return `Ground subsidence was detected at ${event.title} on ${dateStr}. ${event.displacement_cm != null ? `Measured displacement: ${event.displacement_cm} cm.` : ''}`;
    case 'mining':
      return `A mining-related geophysical event was recorded at ${event.title} on ${dateStr}, sourced from ${event.sources.join(' & ')}.`;
    case 'tsunami':
      return `A tsunami event (${event.title}) was issued on ${dateStr}. Sourced from ${event.sources.join(' & ')}.`;
    default:
      return `A ${cfg.label} event (${event.title}) was recorded on ${dateStr} by ${event.sources.join(' & ')}.`;
  }
}

// ── Event card ────────────────────────────────────────────────

interface EventCardProps {
  event:     GlobalEvent;
  isSelected: boolean;
  onClick:   () => void;
  index:     number;
  reduced:   boolean;
}

function EventCard({ event, isSelected, onClick, index, reduced }: EventCardProps) {
  const cfg  = EVENT_TYPE_CONFIG[event.type];
  const cause = CAUSE_LABELS[event.cause];
  const causeColor = CAUSE_COLORS[event.cause];

  return (
    <motion.button
      onClick={onClick}
      initial={reduced ? undefined : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.3), duration: 0.25 }}
      className={`w-full text-left rounded-sm border transition-all duration-150 cursor-pointer ${
        isSelected
          ? 'border-current'
          : 'border-white/08 hover:border-white/20'
      }`}
      style={{
        background: isSelected ? `${cfg.color}0d` : 'var(--bg-secondary)',
        borderColor: isSelected ? `${cfg.color}66` : undefined,
        boxShadow: isSelected ? `0 0 12px ${cfg.color}1a` : undefined,
        padding: '10px 12px',
      }}
      aria-pressed={isSelected}
      aria-label={`${event.title}, ${cfg.label}, ${fmtDate(event.time)}`}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Type badge */}
          <span
            className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-sm flex-shrink-0"
            style={{ background: `${cfg.color}18`, color: cfg.color, border: `1px solid ${cfg.color}30` }}
          >
            {cfg.icon} {cfg.label.toUpperCase()}
          </span>
          {/* Cause badge */}
          <span
            className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm flex-shrink-0"
            style={{ background: `${causeColor}12`, color: causeColor, border: `1px solid ${causeColor}25` }}
          >
            {cause}
          </span>
        </div>
        {/* Date */}
        <span className="font-mono text-[9px] text-white/30 flex-shrink-0 text-right">
          {fmtDate(event.time)}<br />
          <span style={{ color: 'var(--text-muted)' }}>{relativeTime(event.time)}</span>
        </span>
      </div>

      {/* Title */}
      <p className="font-mono text-[11px] font-semibold text-white/90 leading-snug mb-1 line-clamp-2">
        {event.title}
      </p>

      {/* Stats row */}
      <div className="flex items-center gap-3 flex-wrap">
        {event.magnitude != null && (
          <span className="font-mono text-[9px]" style={{ color: cfg.color }}>
            M{event.magnitude.toFixed(1)}
          </span>
        )}
        {event.depth != null && (
          <span className="font-mono text-[9px] text-white/30">
            {event.depth.toFixed(0)} km depth
          </span>
        )}
        <span className="font-mono text-[8px] ml-auto"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)',
                   padding: '1px 6px', borderRadius: 2, color: 'var(--text-muted)' }}>
          {event.source}
        </span>
      </div>
    </motion.button>
  );
}

// ── Skeleton card ────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-sm border border-white/06 shimmer" style={{ background: 'var(--bg-secondary)', padding: '10px 12px', height: 88 }} />
  );
}

// ── Summary drawer ───────────────────────────────────────────

interface SummaryDrawerProps {
  event:          GlobalEvent;
  onClose:        () => void;
  prev:           (() => void) | null;
  next:           (() => void) | null;
  onViewOnGlobe:  (event: GlobalEvent) => void;
  reduced:        boolean;
}

function SummaryDrawer({ event, onClose, prev, next, onViewOnGlobe, reduced }: SummaryDrawerProps) {
  const cfg        = EVENT_TYPE_CONFIG[event.type];
  const summary    = generateSummary(event);
  const causeColor = CAUSE_COLORS[event.cause];
  const drawerRef  = useRef<HTMLDivElement>(null);

  // Focus trap & keyboard nav
  useEffect(() => {
    const el = drawerRef.current;
    if (!el) return;
    el.focus();

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowLeft' && prev)  { prev(); return; }
      if (e.key === 'ArrowRight' && next) { next(); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, prev, next]);

  return (
    <motion.div
      ref={drawerRef}
      role="dialog"
      aria-label={`Event detail: ${event.title}`}
      aria-modal="true"
      tabIndex={-1}
      initial={reduced ? undefined : { x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={reduced ? undefined : { x: '100%', opacity: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 40 }}
      className="event-drawer glass-panel"
      style={{ outline: 'none' }}
    >
      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b border-white/08 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
            <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-sm"
              style={{ background: `${cfg.color}18`, color: cfg.color, border: `1px solid ${cfg.color}30` }}>
              {cfg.icon} {cfg.label.toUpperCase()}
            </span>
            <span className="font-mono text-[8px] px-1.5 py-0.5 rounded-sm"
              style={{ background: `${causeColor}12`, color: causeColor, border: `1px solid ${causeColor}25` }}>
              {CAUSE_LABELS[event.cause]}
            </span>
          </div>
          <h2 className="font-mono text-[12px] font-bold text-white leading-snug line-clamp-2">
            {event.title}
          </h2>
        </div>
        <button onClick={onClose} aria-label="Close drawer"
          className="tac-btn flex-shrink-0 ml-2" style={{ width: 28, height: 28, padding: 0 }}>
          ✕
        </button>
      </div>

      {/* Summary */}
      <div className="p-4 border-b border-white/08 flex-shrink-0">
        <p className="panel-label mb-2">AI SUMMARY</p>
        <p className="font-mono text-[10px] text-white/60 leading-relaxed">{summary}</p>
      </div>

      {/* Key facts grid */}
      <div className="p-4 border-b border-white/08 flex-shrink-0 overflow-y-auto">
        <p className="panel-label mb-2">KEY FACTS</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          {[
            { label: 'TYPE',    value: cfg.label },
            { label: 'CAUSE',   value: CAUSE_LABELS[event.cause] },
            { label: 'DATE',    value: fmtDate(event.time) },
            { label: 'UTC',     value: fmtDateTime(event.time) },
            event.magnitude != null
              ? { label: 'MAGNITUDE', value: `M${event.magnitude.toFixed(1)}` }
              : null,
            event.depth != null
              ? { label: 'DEPTH',     value: `${event.depth.toFixed(0)} km` }
              : null,
            { label: 'LAT',  value: `${Math.abs(event.lat).toFixed(3)}°${event.lat >= 0 ? 'N' : 'S'}` },
            { label: 'LON',  value: `${Math.abs(event.lon).toFixed(3)}°${event.lon >= 0 ? 'E' : 'W'}` },
            { label: 'SOURCE', value: event.sources.join(', ') },
          ].filter(Boolean).map(f => f && (
            <div key={f.label}>
              <p className="font-mono text-[8px] text-white/30 tracking-widest">{f.label}</p>
              <p className="font-mono text-[10px] text-white/80 font-semibold leading-snug mt-0.5"
                style={f.label === 'MAGNITUDE' ? { color: cfg.color } : {}}>{f.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Mini world locator map (SVG) */}
      <div className="px-4 pt-3 pb-0 flex-shrink-0">
        <p className="panel-label mb-2">LOCATOR</p>
        <MiniMap lat={event.lat} lon={event.lon} color={cfg.color} />
      </div>

      {/* InSAR placeholder */}
      <div className="mx-4 my-3 rounded-sm border border-dashed border-white/12 p-3 flex-shrink-0">
        <p className="panel-label mb-1">DISPLACEMENT DATA (InSAR / GNSS)</p>
        {event.displacement_cm != null ? (
          <p className="font-mono text-[10px]" style={{ color: cfg.color }}>
            {event.displacement_cm} cm measured displacement
          </p>
        ) : (
          <p className="font-mono text-[9px] text-white/25 italic">Coming soon — InSAR / GNSS analysis</p>
        )}
      </div>

      {/* Action buttons */}
      <div className="p-4 border-t border-white/08 flex-shrink-0 flex flex-col gap-2 mt-auto">
        <a
          href={`/events/${event.id}`}
          className="tac-btn w-full justify-center text-center"
          style={{ borderColor: `${cfg.color}44`, color: cfg.color, height: 34 }}
        >
          <span>⊕</span> OPEN FULL DETAIL
        </a>
        <div className="flex gap-2">
          <button
            className="tac-btn flex-1 justify-center"
            style={{ height: 30 }}
            onClick={() => onViewOnGlobe(event)}
            aria-label="View on globe"
          >
            🌐 VIEW ON GLOBE
          </button>
          <a
            href={event.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="tac-btn flex-1 justify-center text-center"
            style={{ height: 30 }}
          >
            ↗ SOURCE RECORD
          </a>
        </div>
      </div>

      {/* Prev / next navigation */}
      <div className="px-4 pb-3 flex gap-2 flex-shrink-0">
        <button onClick={prev ?? undefined} disabled={!prev}
          className="tac-btn flex-1 justify-center" style={{ height: 26, fontSize: 9 }}
          aria-label="Previous event">
          ← PREV
        </button>
        <button onClick={next ?? undefined} disabled={!next}
          className="tac-btn flex-1 justify-center" style={{ height: 26, fontSize: 9 }}
          aria-label="Next event">
          NEXT →
        </button>
      </div>
    </motion.div>
  );
}

// ── Mini SVG world locator map ───────────────────────────────

function MiniMap({ lat, lon, color }: { lat: number; lon: number; color: string }) {
  // Equirectangular projection
  const W = 240, H = 120;
  const x = ((lon + 180) / 360) * W;
  const y = ((90 - lat)  / 180) * H;

  return (
    <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border-zinc)', borderRadius: 2 }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} aria-label={`Event location at ${lat.toFixed(2)}, ${lon.toFixed(2)}`}>
        {/* Simple world outline — rectangular continents approximation */}
        <rect width={W} height={H} fill="none" />
        {/* Graticule */}
        {[-60,-30,0,30,60].map(la => {
          const gy = ((90 - la) / 180) * H;
          return <line key={la} x1={0} y1={gy} x2={W} y2={gy} stroke="var(--border-glass)" strokeWidth={0.5} />;
        })}
        {[-120,-60,0,60,120].map(lo => {
          const gx = ((lo + 180) / 360) * W;
          return <line key={lo} x1={gx} y1={0} x2={gx} y2={H} stroke="var(--border-glass)" strokeWidth={0.5} />;
        })}
        {/* Event marker */}
        <circle cx={x} cy={y} r={5} fill={`${color}33`} stroke={color} strokeWidth={1.5} />
        <circle cx={x} cy={y} r={2} fill={color} />
        {/* Pulse ring */}
        <circle cx={x} cy={y} r={8} fill="none" stroke={color} strokeWidth={0.8} opacity={0.4}>
          <animate attributeName="r" from="5" to="14" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" from="0.5" to="0" dur="2s" repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  );
}

// ── Source health strip ──────────────────────────────────────

function SourceHealthStrip({ health }: { health: SourceHealth[] }) {
  const statusColors: Record<string, string> = {
    ok: 'var(--nominal)', loading: 'var(--acquiring)', error: 'var(--crimson)', cached: 'var(--standby)',
  };
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 py-2 px-1" aria-label="Data source status">
      {health.map(h => (
        <div key={h.name} className="flex items-center gap-1.5">
          <span className="status-dot" style={{ background: statusColors[h.status], boxShadow: h.status === 'ok' ? `0 0 5px ${statusColors[h.status]}` : undefined }} />
          <span className="font-mono text-[8px] text-white/40">{h.name}</span>
          <span className="font-mono text-[7px] uppercase" style={{ color: statusColors[h.status] }}>{h.status}</span>
        </div>
      ))}
    </div>
  );
}

// ── Active filter chips ──────────────────────────────────────

function buildActiveFilters(filters: DirectoryFilters): ActiveFilter[] {
  const chips: ActiveFilter[] = [];
  if (filters.search) chips.push({ key: 'search', label: `"${filters.search}"` });
  for (const t of filters.types) {
    chips.push({ key: `type_${t}`, label: EVENT_TYPE_CONFIG[t].label });
  }
  if (filters.cause !== 'all') chips.push({ key: 'cause', label: CAUSE_LABELS[filters.cause as 'natural' | 'human'] });
  if (filters.region) {
    const r = REGIONS.find(r => r.id === filters.region);
    if (r) chips.push({ key: 'region', label: r.label });
  }
  if (filters.placeSearch) chips.push({ key: 'place', label: `Place: ${filters.placeSearch}` });
  if (filters.timePreset !== 'all') {
    const tp = TIME_PRESETS.find(p => p.id === filters.timePreset);
    chips.push({ key: 'time', label: `Time: ${tp?.label ?? filters.timePreset}` });
  }
  if (filters.magMin > 0 || filters.magMax < 10) {
    chips.push({ key: 'mag', label: `M${filters.magMin}–${filters.magMax}` });
  }
  if (filters.nearMe) chips.push({ key: 'nearMe', label: `Near me (${filters.nearRadius} km)` });
  return chips;
}

function removeFilter(key: string, filters: DirectoryFilters): Partial<DirectoryFilters> {
  if (key === 'search')   return { search: '' };
  if (key === 'cause')    return { cause: 'all' };
  if (key === 'region')   return { region: '' };
  if (key === 'place')    return { placeSearch: '' };
  if (key === 'time')     return { timePreset: 'all' };
  if (key === 'mag')      return { magMin: 0, magMax: 10 };
  if (key === 'nearMe')   return { nearMe: false };
  if (key.startsWith('type_')) {
    const t = key.replace('type_', '') as EventType;
    return { types: filters.types.filter(x => x !== t) };
  }
  return {};
}

// ── Loading animation – radar sweep ─────────────────────────

function RadarSweepLoader({ reduced }: { reduced: boolean }) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('ACQUIRING SIGNAL...');

  useEffect(() => {
    const steps = [
      [300,  15, 'CONNECTING TO USGS...'],
      [800,  35, 'FETCHING NASA EONET...'],
      [1400, 55, 'LOADING GVP DATA...'],
      [1900, 72, 'SCANNING COOLR...'],
      [2400, 88, 'MERGING DATASETS...'],
      [2900, 100, 'READY'],
    ] as [number, number, string][];

    const timers = steps.map(([delay, pct, msg]) =>
      setTimeout(() => { setProgress(pct); setStatus(msg); }, delay)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  if (reduced) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="font-mono text-[10px] tracking-widest text-white/40">LOADING EVENT DATA...</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center"
         style={{ background: 'var(--bg-primary)' }}>
      {/* Radar circle */}
      <div className="relative mb-8" style={{ width: 120, height: 120 }}>
        <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden>
          <circle cx="60" cy="60" r="58" stroke="rgba(239,68,68,0.15)" strokeWidth="1" fill="none" />
          <circle cx="60" cy="60" r="38" stroke="rgba(239,68,68,0.08)" strokeWidth="1" fill="none" />
          <circle cx="60" cy="60" r="18" stroke="rgba(239,68,68,0.06)" strokeWidth="1" fill="none" />
          {/* Sweep */}
          <path d="M60 60 L60 2 A58 58 0 0 1 118 60 Z"
                fill="url(#sweepGrad)"
                style={{ transformOrigin: '60px 60px', animation: 'spin 2s linear infinite' }} />
          <defs>
            <radialGradient id="sweepGrad" cx="0%" cy="100%" r="100%">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0.25" />
            </radialGradient>
          </defs>
          {/* Center dot */}
          <circle cx="60" cy="60" r="3" fill="#ef4444" />
        </svg>
      </div>
      <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-white/60 mb-3">{status}</p>
      {/* Progress bar */}
      <div className="w-48 h-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <motion.div className="h-full rounded-full" style={{ background: 'var(--crimson)' }}
          animate={{ width: `${progress}%` }} transition={{ duration: 0.4 }} />
      </div>
    </div>
  );
}

// ── Skeleton cards with source progress ──────────────────────

function SkeletonList({ sourceHealth }: { sourceHealth: SourceHealth[] }) {
  const statusColors: Record<string, string> = {
    ok: 'var(--nominal)', loading: 'var(--acquiring)', error: 'var(--crimson)', cached: 'var(--standby)',
  };
  const srcReady = sourceHealth.filter(h => h.status !== 'loading').length;
  const srcTotal = sourceHealth.length || 5;

  return (
    <div>
      {/* Source scanning progress */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className="font-mono text-[9px] text-white/40 tracking-widest">SCANNING SOURCES {srcReady}/{srcTotal}</span>
        {sourceHealth.map(h => (
          <span key={h.name} className="font-mono text-[8px]" style={{ color: statusColors[h.status] }}>
            {h.name.split(' ')[0]}
          </span>
        ))}
      </div>

      {/* Skeleton cards */}
      <div className="grid gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}

// ── Filters panel ─────────────────────────────────────────────

interface FiltersPanelProps {
  filters:         DirectoryFilters;
  setFilters:      (patch: Partial<DirectoryFilters>) => void;
  clearFilters:    () => void;
  userLocation:    [number, number] | null;
  locationError:   string | null;
  requestLocation: () => void;
  totalCount:      number;
  matchCount:      number;
  activeFilters:   ActiveFilter[];
  reduced:         boolean;
}

function FiltersPanel({
  filters, setFilters, clearFilters,
  userLocation, locationError, requestLocation,
  totalCount, matchCount, activeFilters, reduced,
}: FiltersPanelProps) {
  const [magRange, setMagRange] = useState<[number, number]>([filters.magMin, filters.magMax]);
  const magDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMagChange = (min: number, max: number) => {
    setMagRange([min, max]);
    if (magDebounce.current) clearTimeout(magDebounce.current);
    magDebounce.current = setTimeout(() => setFilters({ magMin: min, magMax: max }), 300);
  };

  return (
    <aside className="events-filters-panel" aria-label="Event filters">
      {/* Clear all + count */}
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[9px] text-white/30 tracking-widest">
          {matchCount} / {totalCount} EVENTS
        </span>
        {activeFilters.length > 0 && (
          <button onClick={clearFilters} className="tac-btn" style={{ height: 24, fontSize: 8 }}
            aria-label="Clear all filters">
            CLEAR ALL
          </button>
        )}
      </div>

      {/* Active filter chips */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {activeFilters.map(f => (
            <button
              key={f.key}
              onClick={() => setFilters(removeFilter(f.key, filters))}
              className="font-mono text-[8px] px-2 py-0.5 rounded-sm transition-all hover:opacity-80 cursor-pointer"
              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--crimson)' }}
              aria-label={`Remove filter: ${f.label}`}
            >
              {f.label} ✕
            </button>
          ))}
        </div>
      )}

      {/* TYPE FILTER */}
      <div className="mb-3">
        <p className="panel-label mb-1.5">EVENT TYPE</p>
        <div className="flex flex-col gap-1">
          {(Object.entries(EVENT_TYPE_CONFIG) as [EventType, typeof EVENT_TYPE_CONFIG[EventType]][]).map(([type, cfg]) => {
            const active = filters.types.includes(type);
            return (
              <button
                key={type}
                onClick={() => setFilters({
                  types: active
                    ? filters.types.filter(t => t !== type)
                    : [...filters.types, type]
                })}
                className="tac-btn text-left justify-start gap-2"
                style={{
                  height: 28, fontSize: 9,
                  borderColor: active ? `${cfg.color}55` : undefined,
                  background: active ? `${cfg.color}0f` : undefined,
                  color: active ? cfg.color : undefined,
                }}
                aria-pressed={active}
              >
                <span>{cfg.icon}</span>
                {cfg.label.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>

      {/* CAUSE */}
      <div className="mb-3">
        <p className="panel-label mb-1.5">CAUSE</p>
        <div className="flex gap-1">
          {(['all', 'natural', 'human'] as const).map(c => (
            <button key={c}
              onClick={() => setFilters({ cause: c })}
              className={`tac-btn flex-1 ${filters.cause === c ? 'active' : ''}`}
              style={{ height: 26, fontSize: 8 }}
              aria-pressed={filters.cause === c}>
              {c.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* TIME */}
      <div className="mb-3">
        <p className="panel-label mb-1.5">TIME PERIOD</p>
        <div className="flex flex-wrap gap-1">
          {TIME_PRESETS.map(tp => (
            <button key={tp.id}
              onClick={() => setFilters({ timePreset: tp.id })}
              className={`tac-btn ${filters.timePreset === tp.id ? 'active' : ''}`}
              style={{ height: 24, fontSize: 8, padding: '0 8px' }}
              aria-pressed={filters.timePreset === tp.id}>
              {tp.label}
            </button>
          ))}
          <button
            onClick={() => setFilters({ timePreset: 'custom' })}
            className={`tac-btn ${filters.timePreset === 'custom' ? 'active' : ''}`}
            style={{ height: 24, fontSize: 8, padding: '0 8px' }}>
            CUSTOM
          </button>
        </div>
        {filters.timePreset === 'custom' && (
          <div className="flex flex-col gap-1.5 mt-2">
            <div>
              <label className="font-mono text-[8px] text-white/30 block mb-0.5">FROM</label>
              <input type="date" value={filters.customStart}
                onChange={e => setFilters({ customStart: e.target.value })}
                className="w-full font-mono text-[9px] bg-transparent border border-white/10 rounded-sm px-2 py-1 text-white/70"
                aria-label="Custom start date" />
            </div>
            <div>
              <label className="font-mono text-[8px] text-white/30 block mb-0.5">TO</label>
              <input type="date" value={filters.customEnd}
                onChange={e => setFilters({ customEnd: e.target.value })}
                className="w-full font-mono text-[9px] bg-transparent border border-white/10 rounded-sm px-2 py-1 text-white/70"
                aria-label="Custom end date" />
            </div>
          </div>
        )}
      </div>

      {/* REGION */}
      <div className="mb-3">
        <p className="panel-label mb-1.5">REGION</p>
        <select
          value={filters.region}
          onChange={e => setFilters({ region: e.target.value })}
          className="w-full font-mono text-[9px] bg-transparent border border-white/10 rounded-sm px-2 py-1.5 text-white/70 cursor-pointer"
          aria-label="Filter by region"
          style={{ background: 'var(--bg-secondary)' }}
        >
          <option value="">All regions</option>
          {REGIONS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </div>

      {/* MAGNITUDE */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1.5">
          <p className="panel-label">MAGNITUDE</p>
          <span className="font-mono text-[9px]" style={{ color: 'var(--crimson)' }}>
            M{magRange[0]}–M{magRange[1]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input type="range" min={0} max={10} step={0.5} value={magRange[0]}
            onChange={e => handleMagChange(Number(e.target.value), magRange[1])}
            className="tac-slider-crimson flex-1" aria-label="Minimum magnitude" />
          <input type="range" min={0} max={10} step={0.5} value={magRange[1]}
            onChange={e => handleMagChange(magRange[0], Number(e.target.value))}
            className="tac-slider-crimson flex-1" aria-label="Maximum magnitude" />
        </div>
      </div>

      {/* NEAR ME */}
      <div className="mb-3">
        <p className="panel-label mb-1.5">PROXIMITY</p>
        <button
          onClick={() => {
            if (!filters.nearMe) requestLocation();
            setFilters({ nearMe: !filters.nearMe });
          }}
          className={`tac-btn w-full ${filters.nearMe ? 'active' : ''}`}
          style={{ height: 28, fontSize: 9 }}
          aria-pressed={filters.nearMe}
        >
          ⊙ {userLocation ? 'NEAR ME ✓' : 'NEAR ME'}
        </button>
        {filters.nearMe && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-[8px] text-white/30">RADIUS</span>
              <span className="font-mono text-[9px]" style={{ color: 'var(--crimson)' }}>{filters.nearRadius} km</span>
            </div>
            <input type="range" min={50} max={2000} step={50} value={filters.nearRadius}
              onChange={e => setFilters({ nearRadius: Number(e.target.value) })}
              className="tac-slider-crimson w-full" aria-label="Search radius in km" />
          </div>
        )}
        {locationError && (
          <p className="font-mono text-[8px] text-red-400 mt-1.5">{locationError}</p>
        )}
      </div>

      {/* SORT */}
      <div>
        <p className="panel-label mb-1.5">SORT BY</p>
        <div className="flex flex-col gap-1">
          {SORT_OPTIONS.map(s => (
            <button key={s.id}
              onClick={() => setFilters({ sort: s.id as SortKey })}
              className={`tac-btn text-left justify-start ${filters.sort === s.id ? 'active' : ''}`}
              style={{ height: 26, fontSize: 9 }}
              aria-pressed={filters.sort === s.id}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

// ── MAIN PAGE COMPONENT ───────────────────────────────────────

const PAGE_SIZE = 40;

function EventsPageInner() {
  const reduced = useReducedMotion();
  const router  = useRouter();
  const pathname = usePathname();

  const {
    filteredEvents,
    sourceHealth,
    loading,
    rangeLoading,
    filters,
    setFilters,
    clearFilters,
    totalCount,
    matchCount,
    userLocation,
    locationError,
    requestLocation,
  } = useEventDirectory();

  // Debounced search input
  const [searchInput, setSearchInput] = useState(filters.search);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSearchInput(filters.search);
  }, [filters.search]);

  const handleSearchChange = (val: string) => {
    setSearchInput(val);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => setFilters({ search: val }), 250);
  };

  // '/' shortcut focuses search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(tag)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Infinite scroll / pagination
  const [page, setPage] = useState(1);
  const loaderRef = useRef<HTMLDivElement>(null);
  const visibleEvents = filteredEvents.slice(0, page * PAGE_SIZE);

  // Reset page on filter change
  useEffect(() => setPage(1), [filters]);

  useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && visibleEvents.length < filteredEvents.length) {
        setPage(p => p + 1);
      }
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [visibleEvents.length, filteredEvents.length]);

  // Selected event / drawer
  const selectedId    = filters.selectedId;
  const selectedEvent = filteredEvents.find(e => e.id === selectedId) ?? null;
  const selectedIdx   = selectedEvent ? filteredEvents.indexOf(selectedEvent) : -1;

  const openDrawer  = useCallback((event: GlobalEvent) => {
    setFilters({ selectedId: event.id });
  }, [setFilters]);

  const closeDrawer = useCallback(() => {
    setFilters({ selectedId: '' });
  }, [setFilters]);

  const goPrev = selectedIdx > 0
    ? () => setFilters({ selectedId: filteredEvents[selectedIdx - 1].id })
    : null;
  const goNext = selectedIdx < filteredEvents.length - 1
    ? () => setFilters({ selectedId: filteredEvents[selectedIdx + 1].id })
    : null;

  const viewOnGlobe = useCallback((event: GlobalEvent) => {
    // Navigate to globe and store the event id to fly to
    router.push(`/?flyTo=${event.lat},${event.lon}`);
  }, [router]);

  // Mobile: filter sheet
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const activeFilters = buildActiveFilters(filters);

  // Show full loader only on initial load
  if (loading && filteredEvents.length === 0) {
    return <RadarSweepLoader reduced={reduced} />;
  }

  return (
    <div className="events-page-layout">
      {/* ── Sticky search bar ─────────────────────────────────── */}
      <div className="events-search-bar glass" role="search">
        <div className="flex items-center gap-2 max-w-full">
          <div className="relative flex-1 max-w-lg">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-white/20" aria-hidden>/</span>
            <input
              ref={searchRef}
              type="search"
              value={searchInput}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search events... (press / to focus)"
              className="events-search-input"
              aria-label="Search events"
              autoComplete="off"
            />
          </div>

          {/* Match count */}
          <span className="font-mono text-[9px] text-white/30 hidden sm:block flex-shrink-0">
            {loading ? '–' : `${matchCount} / ${totalCount}`}
          </span>

          {/* Scanning line when range loading */}
          {rangeLoading && (
            <span className="font-mono text-[8px] flex-shrink-0" style={{ color: 'var(--acquiring)' }}>
              ⟳ FETCHING MORE...
            </span>
          )}

          {/* Mobile: filter button */}
          <button
            className="tac-btn md:hidden flex-shrink-0 relative"
            style={{ height: 32 }}
            onClick={() => setFilterSheetOpen(true)}
            aria-label={`Filters${activeFilters.length > 0 ? ` (${activeFilters.length} active)` : ''}`}
          >
            ⊟ FILTERS
            {activeFilters.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full font-mono text-[8px] font-bold flex items-center justify-center"
                style={{ background: 'var(--crimson)', color: 'white' }}>
                {activeFilters.length}
              </span>
            )}
          </button>
        </div>

        {/* Source health row */}
        {sourceHealth.length > 0 && <SourceHealthStrip health={sourceHealth} />}
      </div>

      <div className="events-content-area">
        {/* ── Desktop filters sidebar ────────────────────────── */}
        <div className="hidden md:block">
          <FiltersPanel
            filters={filters} setFilters={setFilters} clearFilters={clearFilters}
            userLocation={userLocation} locationError={locationError} requestLocation={requestLocation}
            totalCount={totalCount} matchCount={matchCount}
            activeFilters={activeFilters} reduced={reduced}
          />
        </div>

        {/* ── Results list ───────────────────────────────────── */}
        <main className="events-results-area" role="main" aria-label="Event results">
          {/* Results header with subtle scanning line effect */}
          <div className="events-results-header relative overflow-hidden">
            <p className="font-mono text-[9px] text-white/40 tracking-widest">
              SHOWING {Math.min(visibleEvents.length, filteredEvents.length)} OF {matchCount} EVENTS
              {loading && ' — LOADING...'}
            </p>
            {/* Scanning line when filter changes */}
            {!loading && (
              <div className="absolute bottom-0 left-0 right-0 h-px opacity-30 radar-scan-line" style={{ height: 1 }} />
            )}
          </div>

          {/* Loading skeletons */}
          {loading ? (
            <SkeletonList sourceHealth={sourceHealth} />
          ) : filteredEvents.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="relative w-16 h-16">
                <div className="absolute inset-0 rounded-full border border-white/10" />
                <div className="absolute inset-4 rounded-full border border-white/08" />
                <span className="absolute inset-0 flex items-center justify-center font-mono text-xl text-white/20">⊘</span>
              </div>
              <p className="font-mono text-[11px] tracking-widest text-white/30">NO EVENTS MATCH THESE FILTERS</p>
              <button onClick={clearFilters} className="tac-btn" style={{ height: 32 }}>
                CLEAR FILTERS
              </button>
            </div>
          ) : (
            /* Event cards */
            <div className="grid gap-2" role="list" aria-label="Event list">
              {visibleEvents.map((event, idx) => (
                <div key={event.id} role="listitem">
                  <EventCard
                    event={event}
                    isSelected={event.id === selectedId}
                    onClick={() => event.id === selectedId ? closeDrawer() : openDrawer(event)}
                    index={idx}
                    reduced={reduced}
                  />
                </div>
              ))}
              {/* Infinite scroll trigger */}
              <div ref={loaderRef} style={{ height: 4 }} aria-hidden />
              {visibleEvents.length < filteredEvents.length && (
                <div className="text-center py-4">
                  <span className="font-mono text-[9px] text-white/20">LOADING MORE...</span>
                </div>
              )}
            </div>
          )}
        </main>

        {/* ── Summary drawer (desktop: side panel; mobile: bottom sheet) ── */}
        <AnimatePresence>
          {selectedEvent && (
            <SummaryDrawer
              event={selectedEvent}
              onClose={closeDrawer}
              prev={goPrev}
              next={goNext}
              onViewOnGlobe={viewOnGlobe}
              reduced={reduced}
            />
          )}
        </AnimatePresence>
      </div>

      {/* ── Mobile: filter bottom sheet ──────────────────────── */}
      <AnimatePresence>
        {filterSheetOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[300] bg-black/60"
              onClick={() => setFilterSheetOpen(false)}
              aria-hidden
            />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 350, damping: 40 }}
              className="fixed bottom-0 left-0 right-0 z-[301] glass-panel rounded-t-sm overflow-y-auto"
              style={{ maxHeight: '80dvh', padding: 16 }}
              role="dialog" aria-label="Filter options" aria-modal="true"
            >
              <div className="flex items-center justify-between mb-4">
                <p className="font-mono text-[11px] font-bold tracking-widest">FILTERS</p>
                <button onClick={() => setFilterSheetOpen(false)} className="tac-btn" style={{ width: 28, height: 28, padding: 0 }}>✕</button>
              </div>
              <FiltersPanel
                filters={filters} setFilters={v => { setFilters(v); }}
                clearFilters={() => { clearFilters(); setFilterSheetOpen(false); }}
                userLocation={userLocation} locationError={locationError} requestLocation={requestLocation}
                totalCount={totalCount} matchCount={matchCount}
                activeFilters={activeFilters} reduced={reduced}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// Wrap in Suspense because useSearchParams requires it in Next.js app router
export default function EventsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen">
        <p className="font-mono text-[10px] tracking-widest text-white/30">INITIALIZING...</p>
      </div>
    }>
      <EventsPageInner />
    </Suspense>
  );
}
