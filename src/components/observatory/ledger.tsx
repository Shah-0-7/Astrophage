'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { stormOf, fmtWind } from '@/lib/stormScale';
import { OutlineDefs } from '@/components/ui/outline-defs';
import { useEventDirectory, type DirectoryFilters } from '@/lib/useEventDirectory';
import type { EventType, GlobalEvent } from '@/lib/globalEvents';
import { EVENT_TYPE_CONFIG, REGIONS, SORT_OPTIONS, TIME_PRESETS, type SortKey } from '@/lib/eventDirectoryTypes';
import { estimateDisplacement } from '@/lib/eventPhysics';
import { RegionMap } from './region-map';
import { WATCH_ADD_EVENT } from '@/lib/useWatchlist';
import { StormOutlook } from './storm-outlook';
import { PlaceSuggest } from './place-suggest';
import type { Place } from '@/lib/placeSearch';
import { eventsToCSV, eventsToGeoJSON, download, exportFilename } from '@/lib/exportEvents';
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
function headline(e: GlobalEvent): { prefix: string; value: string; suffix?: string } | null {
  if (e.type === 'storm') { const c = stormOf(e); if (!c) return null; return /^\d$/.test(c.code) ? { prefix: 'CAT', value: c.code } : { prefix: '', value: String(Math.round(e.wind_kts ?? 0)), suffix: 'KT' }; }
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

/** Events near the expanded one, shown faintly on its map. */
function nearby(all: GlobalEvent[], e: GlobalEvent): GlobalEvent[] {
  const out: GlobalEvent[] = [];
  for (const n of all) {
    if (n.id === e.id) continue;
    if (Math.abs(n.lat - e.lat) < 12 && Math.abs(n.lon - e.lon) < 18) { out.push(n); if (out.length >= 80) break; }
  }
  return out;
}

/** Hand the event to the report page so it opens instantly, even for records the feed no longer returns. */
function stashEvent(e: GlobalEvent) {
  try { sessionStorage.setItem(`ob_event_${e.id}`, JSON.stringify(e)); } catch { /* private mode */ }
}

export interface LedgerProps {
  /** Jump to another view centred on this event. */
  onOpen: (view: 'radar' | 'globe', event: GlobalEvent, x: number, y: number) => void;
  /** Jump to the radar centred on a searched place. */
  onPlace?: (place: { lat: number; lon: number; name: string }, x: number, y: number) => void;
}

/** Typographic ledger of live events, driven by the directory's own filter, search and URL-sync hook. */
export function Ledger({ onOpen, onPlace }: LedgerProps) {
  const dir = useEventDirectory();
  const { filters, setFilters, clearFilters, filteredEvents, allEvents, sourceHealth, loading, rangeLoading, matchCount, totalCount, userLocation, locationError, loadMore, loadingMore, hasMore } = dir;
  const [advanced, setAdvanced] = useState(false);
  const [query, setQuery] = useState(filters.search);
  const [shown, setShown] = useState(PAGE);
  const sentinel = useRef<HTMLLIElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(false);

  // Debounce the search box into the URL-synced filter.
  useEffect(() => {
    if (query === filters.search) return;
    const id = setTimeout(() => setFilters({ search: query }), 260);
    return () => clearTimeout(id);
   
  }, [query]);

  // Reset paging when the filters change (not when older events stream in below the fold).
  const filterKey = JSON.stringify({ ...filters, selectedId: '' });
  useEffect(() => { setShown(PAGE); }, [filterKey]);

  // Scrolling to the bottom first reveals more of what is loaded, then pulls in older events from the feeds.
  const total = filteredEvents.length;
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const io = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return;
      if (shown < total) setShown(n => n + PAGE);
      else if (hasMore) loadMore();
    }, { rootMargin: '600px' });
    io.observe(node);
    return () => io.disconnect();
  }, [shown, total, hasMore, loadMore, loadingMore]);

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
    (filters.magMax < 10 ? 1 : 0) + (filters.nearMe ? 1 : 0) + (filters.search ? 1 : 0) + (filters.at ? 1 : 0) + (filters.timePreset !== 'all' ? 1 : 0);

  const pickPlace = (p: Place) => {
    setQuery('');
    setFilters({ search: '', at: [p.lat, p.lon], atName: p.name, nearMe: false });
  };
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) { await navigator.share({ title: 'Astrophage events', url }); return; }
      await navigator.clipboard.writeText(url);
    } catch { try { window.prompt('Copy this link', url); } catch { /* ignore */ } return; }
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };
  const exportAs = (kind: 'csv' | 'geojson') => {
    setMenu(false);
    if (kind === 'csv') download(exportFilename('csv'), eventsToCSV(filteredEvents), 'text/csv;charset=utf-8');
    else download(exportFilename('geojson'), JSON.stringify(eventsToGeoJSON(filteredEvents), null, 2), 'application/geo+json');
  };

  const rows = filteredEvents.slice(0, shown);
  const openEvent = filters.selectedId ? filteredEvents.find(r => r.id === filters.selectedId) ?? null : null;
   
  const nearbyAll = useMemo(() => (openEvent ? nearby(allEvents, openEvent) : []), [openEvent, allEvents.length]);
  // History keeps streaming in; only hand the map a new array when the neighbours actually change, since every change repaints it.
  const nearbyKey = nearbyAll.map(n => n.id).join('|');
   
  const openNeighbors = useMemo(() => nearbyAll, [nearbyKey]);

  return (
    <section className="lg" aria-label="Event ledger">
      <header className="lg-head">
        <div>
          <div className="lg-kicker">ASTROPHAGE / EVENTS</div>
          <h2 className="lg-title"><OutlineDefs /><b className="ol ol-2">LEDGER</b><sup>{String(matchCount).padStart(2, '0')}</sup></h2>
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
          <input ref={searchInput} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search a place (Tokyo), source or type" aria-label="Search events or jump to a place" />
          <PlaceSuggest query={query} onPick={pickPlace} inputRef={searchInput} />
        </label>
        <button type="button" className="lg-more" onClick={share} aria-live="polite">{copied ? 'LINK COPIED ✓' : 'SHARE LINK'}</button>
        <div className="lg-export">
          <button type="button" className="lg-more" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu(m => !m)} disabled={filteredEvents.length === 0}>EXPORT {filteredEvents.length} ▾</button>
          {menu && (
            <div className="lg-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => exportAs('csv')}>CSV<small>Spreadsheet</small></button>
              <button type="button" role="menuitem" onClick={() => exportAs('geojson')}>GEOJSON<small>GIS / maps</small></button>
            </div>
          )}
        </div>
        <button type="button" className="lg-more" aria-expanded={advanced} onClick={() => setAdvanced(a => !a)}>
          MORE FILTERS {advanced ? '−' : '+'}
        </button>
        {(filters.types.length > 0 || filters.region || filters.magMin > 0 || filters.at) && (
          <button type="button" className="lg-more" title="Get alerts for events matching these filters" onClick={() => window.dispatchEvent(new CustomEvent(WATCH_ADD_EVENT, { detail: {
            types: filters.types, region: filters.region, minMagnitude: filters.magMin,
            at: filters.at ? { lat: filters.at[0], lon: filters.at[1], name: filters.atName || 'this spot', radiusKm: filters.nearRadius } : null,
          } }))}>WATCH THESE</button>
        )}
        {activeFilterCount > 0 && <button type="button" className="lg-clear" onClick={() => { setQuery(''); clearFilters(); }}>CLEAR ALL</button>}
      </div>

      {filters.at && (
        <div className="lg-place" role="group" aria-label="Place filter">
          <span>NEAR <b>{(filters.atName || `${filters.at[0].toFixed(1)}, ${filters.at[1].toFixed(1)}`).toUpperCase()}</b></span>
          <select value={filters.nearRadius} aria-label="Radius" onChange={e => setFilters({ nearRadius: Number(e.target.value) })}>
            {[100, 250, 500, 1000, 2000, 5000].map(r => <option key={r} value={r}>{r} KM</option>)}
          </select>
          {onPlace && <button type="button" onClick={ev => { const r = ev.currentTarget.getBoundingClientRect(); onPlace({ lat: filters.at![0], lon: filters.at![1], name: filters.atName }, r.left + r.width / 2, r.top + r.height / 2); }}>SHOW ON RADAR →</button>}
          <button type="button" aria-label="Remove place filter" onClick={() => setFilters({ at: null, atName: '' })}>×</button>
        </div>
      )}

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

      {sourceHealth.some(h => h.status === 'error') && !loading && (
        <p className="lg-alert" role="status">
          {sourceHealth.filter(h => h.status === 'error').map(h => h.name).join(', ')} unavailable right now — showing events from the other sources.
          <button type="button" onClick={() => window.location.reload()}>RETRY</button>
        </p>
      )}

      <Histogram events={filteredEvents} />

      <ol className="lg-list">
        {loading && rows.length === 0 && <li className="lg-note">SYNCING FEEDS…</li>}
        {!loading && rows.length === 0 && <li className="lg-note">NOTHING RECORDED FOR THIS FILTER.</li>}
        {rows.map((e, i) => {
          const h = headline(e), open = filters.selectedId === e.id, cfg = EVENT_TYPE_CONFIG[e.type];
          const disp = estimateDisplacement(e);
          return (
            <li key={e.id} className="lg-row" data-open={open} style={{ '--c': cfg.color, '--d': `${Math.min(i, 14) * 28}ms` } as React.CSSProperties}>
              <button type="button" className="lg-main" aria-expanded={open} onClick={() => setFilters({ selectedId: open ? '' : e.id })}>
                <span className="lg-idx">{String(i + 1).padStart(2, '0')}</span>
                <span className="lg-num">
                  {h ? <><small>{h.prefix}</small><b className="ol ol-1">{h.value}</b>{h.suffix && <small className="lg-suffix">{h.suffix}</small>}</> : <span className="lg-glyph">{cfg.icon}</span>}
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
                    {open && <RegionMap event={e} neighbors={openNeighbors} />}
                    <dl className="lg-stats">
                      <div><dt>Source</dt><dd>{e.sources.join(' + ')}</dd></div>
                      <div><dt>Observed</dt><dd>{utc(e.time)}</dd></div>
                      {e.type === 'storm' ? (() => { const c = stormOf(e); return (<>
                        <div><dt>Category</dt><dd>{c ? c.full : 'Not reported'}</dd>{c && <small>{c.band} sustained wind</small>}</div>
                        <div><dt>Max wind</dt><dd>{e.wind_kts != null ? fmtWind(e.wind_kts) : '—'}</dd>{e.pressure_mb != null && <small>{Math.round(e.pressure_mb)} hPa central pressure</small>}</div>
                      </>); })() : (<>
                      <div><dt>{e.source === 'Smithsonian GVP' ? 'VEI' : 'Magnitude'}</dt><dd>{e.magnitude != null ? (e.source === 'Smithsonian GVP' ? Math.round(e.magnitude) : e.magnitude.toFixed(1)) : '—'}</dd></div>
                      <div><dt>Depth</dt><dd>{e.depth != null ? `${e.depth.toFixed(1)} KM` : '—'}</dd></div></>)}
                      {e.type === 'storm' && open && <StormOutlook event={e} className="lg-wide" />}
                      {e.type !== 'storm' && <div className="lg-wide"><dt>Surface displacement</dt><dd>{disp.label}</dd><small>{disp.note}</small></div>}
                      {disp.rupture && <div><dt>Rupture area (est.)</dt><dd>{disp.rupture.areaKm2 < 10 ? disp.rupture.areaKm2.toFixed(1) : Math.round(disp.rupture.areaKm2).toLocaleString()} KM²</dd></div>}
                      {disp.rupture && <div><dt>Rupture size (est.)</dt><dd>{disp.rupture.lengthKm.toFixed(0)} × {disp.rupture.widthKm.toFixed(0)} KM</dd></div>}
                    </dl>
                    <div className="lg-links">
                      <button type="button" onClick={ev => { const r = ev.currentTarget.getBoundingClientRect(); onOpen('radar', e, r.left + r.width / 2, r.top + r.height / 2); }}>OPEN IN RADAR →</button>
                      <button type="button" className="lg-ghost" onClick={ev => { const r = ev.currentTarget.getBoundingClientRect(); onOpen('globe', e, r.left + r.width / 2, r.top + r.height / 2); }}>SHOW ON GLOBE</button>
                      <Link href={`/events/${encodeURIComponent(e.id)}`} className="lg-ghost" onClick={() => stashEvent(e)}>FULL REPORT</Link>
                      <a href={e.source_url} target="_blank" rel="noreferrer" className="lg-ghost">SOURCE ↗</a>
                    </div>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
        {(rows.length < filteredEvents.length || hasMore) && (
          <li ref={sentinel} className="lg-note">{rows.length >= filteredEvents.length && loadingMore ? 'LOADING OLDER EVENTS…' : 'LOADING MORE…'}</li>
        )}
      </ol>
    </section>
  );
}

export type { DirectoryFilters };
