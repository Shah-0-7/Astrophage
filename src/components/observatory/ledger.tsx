'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useEventDirectory, type DirectoryFilters } from '@/lib/useEventDirectory';
import type { EventType, GlobalEvent } from '@/lib/globalEvents';
import { EVENT_TYPE_CONFIG, REGIONS, SORT_OPTIONS, TIME_PRESETS, type SortKey } from '@/lib/eventDirectoryTypes';
import './ledger.css';

const TYPES = Object.keys(EVENT_TYPE_CONFIG) as EventType[];
const PAGE = 40;

/* ── formatting ───────────────────────────────────────────────── */
function ago(ms: number) {
  const diff = Math.max(0, Date.now() - ms);
  const m = Math.floor(diff / 60_000), h = Math.floor(diff / 3_600_000), d = Math.floor(diff / 86_400_000);
  if (m < 60) return `${m}M AGO`;
  if (h < 24) return `${h}H AGO`;
  if (d < 365) return `${d}D AGO`;
  return `${Math.floor(d / 365)}Y AGO`;
}
function utc(ms: number) {
  const d = new Date(ms);
  return `${d.toISOString().slice(0, 10)} · ${d.toISOString().slice(11, 16)} UTC`;
}
function coords(e: GlobalEvent) {
  return `${Math.abs(e.lat).toFixed(2)}°${e.lat >= 0 ? 'N' : 'S'} ${Math.abs(e.lon).toFixed(2)}°${e.lon >= 0 ? 'E' : 'W'}`;
}
function headline(e: GlobalEvent): { prefix: string; value: string } | null {
  if (e.magnitude == null) return null;
  if (e.source === 'Smithsonian GVP') return { prefix: 'VEI', value: String(Math.round(e.magnitude)) };
  return { prefix: 'M', value: e.magnitude.toFixed(1) };
}

/* ── activity histogram across the matched time span ──────────── */
function Histogram({ events }: { events: GlobalEvent[] }) {
  const bins = 40;
  const { counts, peak } = useMemo(() => {
    const c = new Array(bins).fill(0) as number[];
    if (events.length) {
      let min = Infinity, max = -Infinity;
      for (const e of events) { if (e.time < min) min = e.time; if (e.time > max) max = e.time; }
      const span = Math.max(1, max - min);
      for (const e of events) c[Math.min(bins - 1, Math.floor(((e.time - min) / span) * bins))] += 1;
    }
    return { counts: c, peak: Math.max(1, ...c) };
  }, [events]);
  return (
    <div aria-hidden="true" className="lg-hist">
      {counts.map((c, i) => <span key={i} style={{ height: `${6 + (c / peak) * 94}%`, opacity: c ? 0.35 + 0.65 * (c / peak) : 0.12 }} />)}
    </div>
  );
}

/* ── dot-lattice locator with a pulsing marker ────────────────── */
function Locator({ event }: { event: GlobalEvent }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const color = EVENT_TYPE_CONFIG[event.type].color;
    let raf = 0;
    const draw = (time: number) => {
      const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const mx = ((event.lon + 180) / 360) * w, my = ((90 - event.lat) / 180) * h, step = 9;
      for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) {
        const d = Math.hypot(x - mx, y - my);
        const wave = reduce ? 0 : Math.max(0, 1 - Math.abs(d - ((time / 14) % 160)) / 14);
        ctx.fillStyle = `rgba(255,255,255,${(0.1 + 0.55 * Math.exp(-d / 46) + wave * 0.5).toFixed(3)})`;
        ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(0, my + 0.5); ctx.lineTo(w, my + 0.5); ctx.moveTo(mx + 0.5, 0); ctx.lineTo(mx + 0.5, h); ctx.stroke();
      const g = ctx.createRadialGradient(mx, my, 0, mx, my, 26);
      g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.45; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(mx, my, 26, 0, 7); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(mx, my, 3, 0, 7); ctx.fill();
      ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(mx, my, 8, 0, 7); ctx.stroke();
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [event]);
  return <canvas ref={ref} className="lg-locator" aria-hidden="true" />;
}

export interface LedgerProps {
  /** Jump to another view centred on this event. */
  onOpen: (view: 'radar' | 'globe', event: GlobalEvent, x: number, y: number) => void;
}

/** Typographic ledger of live events, driven by the directory's own filter, search and URL-sync hook. */
export function Ledger({ onOpen }: LedgerProps) {
  const dir = useEventDirectory();
  const { filters, setFilters, clearFilters, filteredEvents, allEvents, sourceHealth, loading, rangeLoading, matchCount, totalCount, userLocation, locationError } = dir;
  const [advanced, setAdvanced] = useState(false);
  const [query, setQuery] = useState(filters.search);
  const [shown, setShown] = useState(PAGE);
  const sentinel = useRef<HTMLLIElement>(null);

  // Debounce the search box into the URL-synced filter.
  useEffect(() => {
    if (query === filters.search) return;
    const id = setTimeout(() => setFilters({ search: query }), 260);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Reset paging whenever the result set changes; load more as the sentinel scrolls into view.
  useEffect(() => { setShown(PAGE); }, [filteredEvents]);
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const io = new IntersectionObserver(entries => { if (entries[0].isIntersecting) setShown(n => n + PAGE); }, { rootMargin: '400px' });
    io.observe(node);
    return () => io.disconnect();
  }, [shown, filteredEvents]);

  const typeCounts = useMemo(() => {
    const m = {} as Record<EventType, number>;
    TYPES.forEach(t => (m[t] = 0));
    allEvents.forEach(e => { if (m[e.type] !== undefined) m[e.type] += 1; });
    return m;
  }, [allEvents]);

  const toggleType = (t: EventType) => {
    const next = filters.types.includes(t) ? filters.types.filter(x => x !== t) : [...filters.types, t];
    setFilters({ types: next });
  };
  const activeFilterCount =
    filters.types.length + (filters.cause !== 'all' ? 1 : 0) + (filters.region ? 1 : 0) + (filters.magMin > 0 ? 1 : 0) +
    (filters.magMax < 10 ? 1 : 0) + (filters.nearMe ? 1 : 0) + (filters.search ? 1 : 0) + (filters.timePreset !== 'all' ? 1 : 0);

  const rows = filteredEvents.slice(0, shown);

  return (
    <section className="lg" aria-label="Event ledger">
      <header className="lg-head">
        <div>
          <div className="lg-kicker">ASTROPHAGE / EVENTS</div>
          <h2 className="lg-title">LEDGER<sup>{String(matchCount).padStart(2, '0')}</sup></h2>
        </div>
        <div className="lg-controls">
          <div className="lg-group" role="group" aria-label="Time window">
            {TIME_PRESETS.map(p => (
              <button key={p.id} type="button" className="lg-pill" data-on={filters.timePreset === p.id} aria-pressed={filters.timePreset === p.id} onClick={() => setFilters({ timePreset: p.id })}>{p.label}</button>
            ))}
          </div>
          <div className="lg-group" role="group" aria-label="Sort">
            {SORT_OPTIONS.map(s => (
              <button key={s.id} type="button" className="lg-pill" data-on={filters.sort === s.id} aria-pressed={filters.sort === s.id} onClick={() => setFilters({ sort: s.id as SortKey })}>
                {s.id === 'magnitude_desc' ? 'LARGEST' : s.label.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="lg-tools">
        <label className="lg-search">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="1.4"><circle cx="6" cy="6" r="4.5" /><path d="M9.5 9.5L13 13" /></svg>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search place, source or type" aria-label="Search events" />
        </label>
        <button type="button" className="lg-more" aria-expanded={advanced} onClick={() => setAdvanced(a => !a)}>
          MORE FILTERS {advanced ? '−' : '+'}
        </button>
        {activeFilterCount > 0 && <button type="button" className="lg-clear" onClick={() => { setQuery(''); clearFilters(); }}>CLEAR ALL</button>}
      </div>

      <div className="lg-filters" role="group" aria-label="Event type">
        {TYPES.map(t => (
          <button key={t} type="button" className="lg-chip" data-on={filters.types.includes(t)} aria-pressed={filters.types.includes(t)} style={{ '--c': EVENT_TYPE_CONFIG[t].color } as React.CSSProperties} onClick={() => toggleType(t)}>
            <i />{EVENT_TYPE_CONFIG[t].label}<b>{typeCounts[t]}</b>
          </button>
        ))}
      </div>

      {advanced && (
        <div className="lg-adv">
          <label>Cause
            <div className="lg-seg" role="group">
              {(['all', 'natural', 'human'] as const).map(c => (
                <button key={c} type="button" data-on={filters.cause === c} aria-pressed={filters.cause === c} onClick={() => setFilters({ cause: c })}>{c.toUpperCase()}</button>
              ))}
            </div>
          </label>
          <label>Region
            <select value={filters.region} onChange={e => setFilters({ region: e.target.value })}>
              <option value="">Anywhere</option>
              {REGIONS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          <label>Minimum magnitude · {filters.magMin.toFixed(1)}
            <input type="range" min={0} max={9} step={0.5} value={filters.magMin} onChange={e => setFilters({ magMin: Number(e.target.value) })} />
          </label>
          <label>Near me
            <div className="lg-seg" role="group">
              <button type="button" data-on={!filters.nearMe} onClick={() => setFilters({ nearMe: false })}>OFF</button>
              <button type="button" data-on={filters.nearMe} onClick={() => setFilters({ nearMe: true })}>{filters.nearRadius} KM</button>
            </div>
            {filters.nearMe && (
              <input type="range" min={100} max={3000} step={100} value={filters.nearRadius} onChange={e => setFilters({ nearRadius: Number(e.target.value) })} />
            )}
            {filters.nearMe && !userLocation && !locationError && <span>Locating…</span>}
            {locationError && <span style={{ color: '#ff9a8a' }}>{locationError}</span>}
          </label>
        </div>
      )}

      <div className="lg-status" aria-live="polite">
        {sourceHealth.map(h => (
          <span key={h.name}><i style={{ background: h.status === 'error' ? '#ff6a5e' : h.status === 'loading' ? '#facc15' : '#4ade80' }} />{h.name.toUpperCase()}</span>
        ))}
        <span>{matchCount} OF {totalCount}</span>
        {rangeLoading && <span>LOADING HISTORY…</span>}
      </div>

      <Histogram events={filteredEvents} />

      <ol className="lg-list">
        {loading && rows.length === 0 && <li className="lg-note">SYNCING FEEDS…</li>}
        {!loading && rows.length === 0 && <li className="lg-note">NOTHING RECORDED FOR THIS FILTER.</li>}
        {rows.map((e, i) => {
          const h = headline(e), open = filters.selectedId === e.id, cfg = EVENT_TYPE_CONFIG[e.type];
          return (
            <li key={e.id} className="lg-row" data-open={open} style={{ '--c': cfg.color, '--d': `${Math.min(i, 14) * 28}ms` } as React.CSSProperties}>
              <button type="button" className="lg-main" aria-expanded={open} onClick={() => setFilters({ selectedId: open ? '' : e.id })}>
                <span className="lg-idx">{String(i + 1).padStart(2, '0')}</span>
                <span className="lg-num">
                  {h ? <><small>{h.prefix}</small>{h.value}</> : <span className="lg-glyph">{cfg.icon}</span>}
                </span>
                <span className="lg-where"><strong>{e.title}</strong><em>{coords(e)}</em></span>
                <span className="lg-kind"><i />{cfg.label}</span>
                <span className="lg-depth">{e.depth != null ? `${Math.round(e.depth)} KM` : '—'}<small>DEPTH</small></span>
                <span className="lg-time">{ago(e.time)}<small>{new Date(e.time).toISOString().slice(0, 10)}</small></span>
                <span className="lg-plus" aria-hidden="true" />
              </button>
              <div className="lg-fold">
                <div className="lg-fold-in">
                  <div className="lg-detail">
                    {open && <Locator event={e} />}
                    <dl className="lg-stats">
                      <div><dt>Source</dt><dd>{e.sources.join(' + ')}</dd></div>
                      <div><dt>Observed</dt><dd>{utc(e.time)}</dd></div>
                      <div><dt>Depth</dt><dd>{e.depth != null ? `${e.depth.toFixed(1)} KM` : '—'}</dd></div>
                      <div><dt>Displacement</dt><dd>{e.displacement_cm != null ? `${e.displacement_cm} CM` : 'PENDING'}</dd></div>
                    </dl>
                    <div className="lg-links">
                      <button type="button" onClick={ev => { const r = ev.currentTarget.getBoundingClientRect(); onOpen('radar', e, r.left + r.width / 2, r.top + r.height / 2); }}>OPEN IN RADAR →</button>
                      <button type="button" className="lg-ghost" onClick={ev => { const r = ev.currentTarget.getBoundingClientRect(); onOpen('globe', e, r.left + r.width / 2, r.top + r.height / 2); }}>SHOW ON GLOBE</button>
                      <Link href={`/events/${encodeURIComponent(e.id)}`} className="lg-ghost">FULL REPORT</Link>
                      <a href={e.source_url} target="_blank" rel="noreferrer" className="lg-ghost">SOURCE ↗</a>
                    </div>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
        {rows.length < filteredEvents.length && <li ref={sentinel} className="lg-note">LOADING MORE…</li>}
      </ol>
    </section>
  );
}

export type { DirectoryFilters };
