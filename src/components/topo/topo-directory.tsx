'use client';

/**
 * The Topo tab's front page: the events whose ground motion NISAR has actually measured. Opening one loads the measured 3D
 * view. Everything listed here is backed by a processed interferogram stored on the site; nothing is simulated.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { OutlineDefs } from '@/components/ui/outline-defs';
import { EVENT_TYPE_CONFIG } from '@/lib/eventDirectoryTypes';
import type { EventType, GlobalEvent } from '@/lib/globalEvents';
import { buildTopoEntries, type TopoEntry } from '@/lib/displacement/directory';
import { fmtRangeCm } from '@/lib/displacement/match';
import { useMeasuredIndexState, useMeasuredSummary } from '@/lib/useMeasured';
import { useStore } from '@/lib/store';
import '@/components/observatory/ledger.css';
import './topo-directory.css';

const PAGE = 30;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const short = (ms: number) => new Date(ms).toISOString().slice(5, 10);
const coords = (e: GlobalEvent) => `${Math.abs(e.lat).toFixed(2)}°${e.lat >= 0 ? 'N' : 'S'} ${Math.abs(e.lon).toFixed(2)}°${e.lon >= 0 ? 'E' : 'W'}`;
function ago(ms: number) {
  const d = Math.max(0, Date.now() - ms), h = Math.floor(d / 3_600_000), dd = Math.floor(d / 86_400_000);
  return h < 24 ? `${Math.max(1, h)}H AGO` : dd < 365 ? `${dd}D AGO` : `${Math.floor(dd / 365)}Y AGO`;
}
function headline(e: GlobalEvent, label: string, orphan: boolean): { prefix: string; value: string; word: boolean } {
  if (e.magnitude == null) return { prefix: '', value: orphan ? 'GRID' : label.toUpperCase(), word: true };
  return e.source === 'Smithsonian GVP' ? { prefix: 'VEI', value: String(Math.round(e.magnitude)), word: false } : { prefix: 'M', value: e.magnitude.toFixed(1), word: false };
}

/** The measured range of one grid. Grids are ~150 KB, so a row reads its own only once it scrolls into view. */
function Measured({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const n = ref.current;
    if (!n || seen) return;
    const io = new IntersectionObserver(es => { if (es[0].isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(n);
    return () => io.disconnect();
  }, [seen]);
  const s = useMeasuredSummary(seen ? id : null);
  return (
    <div ref={ref} className="td-measured">
      <b>{!seen || s === undefined ? '…' : s === null ? 'UNAVAILABLE' : fmtRangeCm(s.lo, s.hi)}</b>
      <small>{s ? `${Math.round(s.coverage * 100)}% COHERENT` : 'LINE-OF-SIGHT'}</small>
    </div>
  );
}

function Row({ entry, index, onOpen }: { entry: TopoEntry; index: number; onOpen: (e: GlobalEvent) => void }) {
  const { event: e, grids } = entry;
  const cfg = EVENT_TYPE_CONFIG[e.type];
  const g = grids[0];
  const h = headline(e, cfg.label, entry.orphan);
  return (
    <li className="lg-row td-row" style={{ '--c': cfg.color, '--d': `${Math.min(index, 12) * 40}ms` } as React.CSSProperties}>
      <button type="button" className="td-main" onClick={() => onOpen(e)} aria-label={`Open ${e.title} in 3D`}>
        <span className="lg-idx">{String(index + 1).padStart(2, '0')}</span>
        <span className={`lg-num td-num${h.word ? ' td-word' : ''}`}>{h.prefix && <small>{h.prefix}</small>}<b className="ol ol-1">{h.value}</b></span>
        <span className="lg-where">
          <strong>{entry.orphan ? `Processed grid near ${coords(e)}` : e.title}</strong>
          <em>{coords(e)}</em>
          <span className="lg-kind"><i style={{ '--c': cfg.color } as React.CSSProperties} />{entry.orphan ? 'No matching event in the directory' : cfg.label}</span>
        </span>
        <span className="lg-time">{day(e.time)}<small>{ago(e.time)}</small></span>
        <span className="td-pair">{short(g.reference)} → {short(g.secondary)}<small>{Math.round((g.secondary - g.reference) / 86_400_000)} DAYS · TRACK {g.track ?? '—'}{grids.length > 1 ? ` · +${grids.length - 1} PAIR${grids.length > 2 ? 'S' : ''}` : ''}</small></span>
        <Measured id={g.id} />
        <span className="td-go">OPEN 3D →</span>
      </button>
    </li>
  );
}

export function TopoDirectory() {
  const { metas, loaded } = useMeasuredIndexState();
  const events = useStore(s => s.directoryEvents);
  const setTopoEvent = useStore(s => s.setTopoEvent);
  const [query, setQuery] = useState('');
  const [types, setTypes] = useState<EventType[]>([]);
  const [sort, setSort] = useState<'new' | 'big'>('new');
  const [shown, setShown] = useState(PAGE);

  const all = useMemo(() => buildTopoEntries(events, metas), [events, metas]);
  const counts = useMemo(() => {
    const m = new Map<EventType, number>();
    for (const r of all) m.set(r.event.type, (m.get(r.event.type) ?? 0) + 1);
    return m;
  }, [all]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = all.filter(r => (types.length === 0 || types.includes(r.event.type)) && (!q || r.event.title.toLowerCase().includes(q) || r.event.type.includes(q) || String(r.grids[0].track ?? '').includes(q)));
    return sort === 'big' ? [...list].sort((a, b) => (b.event.magnitude ?? -1) - (a.event.magnitude ?? -1) || b.event.time - a.event.time) : list;
  }, [all, query, types, sort]);
  useEffect(() => { setShown(PAGE); }, [query, types, sort]);

  const toggle = (t: EventType) => setTypes(c => (c.includes(t) ? c.filter(x => x !== t) : [...c, t]));
  const eventTypes = (Object.keys(EVENT_TYPE_CONFIG) as EventType[]).filter(t => counts.has(t));
  const loading = !loaded || (metas.length > 0 && events.length === 0);

  return (
    <section className="lg td" aria-label="Events with measured NISAR ground motion">
      <header className="lg-head">
        <div>
          <div className="lg-kicker">ASTROPHAGE / TOPO</div>
          <h2 className="lg-title"><OutlineDefs /><b className="ol ol-2">MEASURED</b><sup>{String(all.length).padStart(2, '0')}</sup></h2>
        </div>
        <div className="lg-controls">
          <div className="lg-group" role="group" aria-label="Sort">
            <button type="button" className="lg-pill" data-on={sort === 'new'} aria-pressed={sort === 'new'} onClick={() => setSort('new')}>NEWEST</button>
            <button type="button" className="lg-pill" data-on={sort === 'big'} aria-pressed={sort === 'big'} onClick={() => setSort('big')}>LARGEST</button>
          </div>
        </div>
      </header>

      <p className="td-lede">
        Events whose ground motion NASA&apos;s NISAR satellite has measured. Each opens in 3D with the measured line-of-sight change draped on real terrain.
        These are processed interferograms, not model estimates.
      </p>

      <div className="lg-tools">
        <label className="lg-search">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="1.4"><circle cx="6" cy="6" r="4.5" /><path d="M9.5 9.5L13 13" /></svg>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search a place, type or track number" aria-label="Search measured events" />
        </label>
        {(query || types.length > 0) && <button type="button" className="lg-clear" onClick={() => { setQuery(''); setTypes([]); }}>CLEAR ALL</button>}
      </div>

      {eventTypes.length > 1 && (
        <div className="lg-filters" role="group" aria-label="Event type">
          {eventTypes.map(t => (
            <button key={t} type="button" className="lg-chip" data-on={types.includes(t)} aria-pressed={types.includes(t)} style={{ '--c': EVENT_TYPE_CONFIG[t].color } as React.CSSProperties} onClick={() => toggle(t)}>
              <i />{EVENT_TYPE_CONFIG[t].label}<b>{counts.get(t)}</b>
            </button>
          ))}
        </div>
      )}

      <ul className="lg-list">
        {loading ? <li className="lg-empty">LOADING MEASURED EVENTS…</li>
          : all.length === 0 ? (
            <li className="td-none">
              <b>NOTHING MEASURED YET</b>
              <p>No processed NISAR interferogram is stored on this site. A grid appears here once NISAR has imaged an earthquake before and after it and the pair has been processed. That runs automatically every six hours for magnitude 6 and larger.</p>
              <p>If the site has no database, nothing can be stored; see docs/DISPLACEMENT.md.</p>
            </li>
          ) : rows.length === 0 ? <li className="lg-empty">NO MEASURED EVENTS MATCH</li>
          : rows.slice(0, shown).map((r, i) => <Row key={r.key} entry={r} index={i} onOpen={setTopoEvent} />)}
      </ul>
      {rows.length > shown && <button type="button" className="lg-more td-more" onClick={() => setShown(n => n + PAGE)}>SHOW {Math.min(PAGE, rows.length - shown)} MORE</button>}
    </section>
  );
}
