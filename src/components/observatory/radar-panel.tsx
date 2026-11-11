'use client';

/**
 * Real-data blocks for the radar page's side panel: what NISAR has measured at the selected event, what NASA's catalogue says
 * NISAR has imaged there, and what is inside the current map view. Everything here is read from the site or from a catalogue;
 * nothing is simulated, and measured values are kept visibly apart from modelled ones.
 */

import { useState } from 'react';
import Link from 'next/link';
import type { UnifiedFeature } from '@/lib/types';
import type { EventType, GlobalEvent } from '@/lib/globalEvents';
import { EVENT_TYPE_CONFIG } from '@/lib/eventDirectoryTypes';
import { DEFAULT_RADAR_FILTER, type RadarFilter } from '@/lib/radarEvents';
import { fmtRangeCm, matchFields } from '@/lib/displacement/match';
import { useMeasuredIndex, useMeasuredSummary } from '@/lib/useMeasured';
import { useNisarCoverage } from '@/lib/useNisarCoverage';
import { SPARSE_BELOW } from './measured-displacement';

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export interface EventPoint { lat: number; lon: number; time: number }

/** Where and when a map feature happened, or null when it has no usable position or timestamp. */
export function featurePoint(f: UnifiedFeature): EventPoint | null {
  if (f.geometry.type !== 'Point') return null;
  const [lon, lat] = f.geometry.coordinates as [number, number];
  const p = f.properties as unknown as Record<string, unknown>;
  const raw = f.source === 'seismic' ? p.event_time : f.source === 'volcanism' ? p.last_eruption : f.source === 'tsunami' ? p.issued_at : p.date;
  const time = new Date(String(raw)).getTime();
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(time)) return null;
  return { lat, lon, time };
}

/** The 3D view takes the directory's event shape; earthquakes from the live feed can be described in it directly. */
export function featureToGlobalEvent(f: UnifiedFeature): GlobalEvent | null {
  const pt = featurePoint(f);
  if (!pt || f.source !== 'seismic') return null;
  const p = f.properties as { global_id?: string; place?: string; magnitude?: number; depth_km?: number; source_url?: string; url?: string; source_name?: string };
  return {
    id: p.global_id ?? f.id, type: 'tectonic', cause: 'natural', title: p.place ?? 'Earthquake', lat: pt.lat, lon: pt.lon, time: pt.time,
    magnitude: p.magnitude ?? null, depth: p.depth_km ?? null, displacement_cm: null, source: 'USGS', source_url: p.source_url ?? p.url ?? '',
    sources: p.source_name ? p.source_name.split(' + ') : ['USGS'],
  };
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-3">
      <span className="panel-label shrink-0">{k}</span>
      <span className="font-mono text-[10px] text-white text-right">{children}</span>
    </div>
  );
}

/** Measured NISAR ground motion for the selected event, if a processed interferogram spans it. */
function Measured({ point, onOpen3D }: { point: EventPoint; onOpen3D?: () => void }) {
  const index = useMeasuredIndex();
  const hits = matchFields(index, point);
  const meta = hits[0] ?? null;
  const s = useMeasuredSummary(meta?.id ?? null);
  if (!meta) return null;
  const pass = meta.direction === 'A' ? 'ascending' : meta.direction === 'D' ? 'descending' : null;
  const sparse = s != null && s.coverage < SPARSE_BELOW;
  return (
    <div className="p-3 border-b border-white/10" style={{ background: 'rgba(52,211,153,.05)' }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="panel-label" style={{ color: '#34d399' }}>MEASURED BY NISAR</span>
        <span className="font-mono text-[8px] px-1 py-0.5" style={{ color: '#34d399', border: '1px solid rgba(52,211,153,.5)', borderRadius: 2, letterSpacing: '.12em' }}>REAL DATA</span>
      </div>
      <div className="font-mono text-[15px] font-bold" style={{ color: '#34d399' }}>
        {s === undefined ? 'READING…' : s === null ? 'UNAVAILABLE' : fmtRangeCm(s.lo, s.hi)}
      </div>
      <p className="font-mono text-[9px] leading-snug text-white/55 mt-1">
        L-band, {day(meta.reference)} → {day(meta.secondary)}{meta.track != null ? ` · track ${meta.track}` : ''}{meta.frame != null ? ` · frame ${meta.frame}` : ''}{pass ? ` · ${pass}` : ''} · {meta.maturity.toLowerCase()}
        {hits.length > 1 ? ` · ${hits.length - 1} more pair${hits.length > 2 ? 's' : ''}` : ''}
      </p>
      {s && <p className="font-mono text-[9px] leading-snug text-white/55">{Math.round(s.coverage * 100)}% of the processed area is coherent enough to measure.</p>}
      {sparse && <p className="font-mono text-[9px] leading-snug mt-1" style={{ color: '#fbbf24' }}>Sparse map: extremes may include phase-unwrapping errors (jumps of about 12 cm).</p>}
      <p className="font-mono text-[8px] leading-snug text-white/35 mt-1">Line-of-sight change (+ toward the satellite), 2nd–98th percentile. Not vertical motion; relative to the window edge; atmosphere not corrected.</p>
      {onOpen3D && <button onClick={onOpen3D} className="tac-btn w-full justify-center mt-2" style={{ height: 28, fontSize: 9 }}>OPEN IN 3D →</button>}
    </div>
  );
}

/** What NASA's catalogue says NISAR has imaged at the event: catalogue records, not measurements. */
function Coverage({ point, reportHref }: { point: EventPoint; reportHref?: string }) {
  const st = useNisarCoverage(point);
  let body: React.ReactNode;
  if (st.phase === 'loading') body = <p className="font-mono text-[9px] text-white/40">Checking NASA&apos;s NISAR catalogue…</p>;
  else if (st.phase === 'failed') body = <p className="font-mono text-[9px] text-white/40">The NISAR catalogue could not be reached.</p>;
  else {
    const d = st.data;
    if (d.status === 'unavailable') body = <p className="font-mono text-[9px] text-white/40">NASA&apos;s catalogue is not responding, so NISAR coverage is unknown.</p>;
    else if (d.status === 'future') body = <p className="font-mono text-[9px] text-white/40">This event has not happened yet.</p>;
    else if (d.status === 'pre-mission') body = <p className="font-mono text-[9px] text-white/40">Before NISAR&apos;s public archive begins ({day(d.archiveStart)}).</p>;
    else {
      const c = d.coverage;
      const spans = d.interferograms.filter(i => i.fit === 'spans-event').length;
      body = c.total === 0 ? (
        <p className="font-mono text-[9px] text-white/55">No NISAR scenes cover this location in the catalogue yet.</p>
      ) : (
        <div className="space-y-1.5">
          <Row k="IMAGED">{c.total.toLocaleString()}×{d.truncated ? '+' : ''}</Row>
          {c.lastSeen != null && <Row k="LATEST PASS">{day(c.lastSeen)}</Row>}
          <Row k="SINCE EVENT">{c.afterEvent}</Row>
          <Row k="SPANNING PAIRS">{spans}</Row>
          <p className="font-mono text-[8px] leading-snug text-white/40">
            {spans > 0 ? 'Interferograms with a date before and after the event exist; they should hold its ground motion.' : 'No published interferogram spans this event yet.'}
          </p>
          {d.partial && <p className="font-mono text-[8px] leading-snug text-white/40">Part of the catalogue did not respond; counts may be low.</p>}
        </div>
      );
    }
  }
  return (
    <div className="p-3 border-b border-white/10">
      <div className="flex items-center justify-between mb-2">
        <span className="panel-label">NISAR COVERAGE</span>
        <span className="font-mono text-[8px] text-white/35 tracking-wider">NASA CMR</span>
      </div>
      {body}
      {reportHref && <Link href={reportHref} className="font-mono text-[9px] mt-2 inline-block" style={{ color: '#ffb28f' }}>All pairs in the full report →</Link>}
    </div>
  );
}

/** Measured displacement and NISAR coverage for the selected event. */
export function EventNisar({ feature, onOpen3D }: { feature: UnifiedFeature; onOpen3D?: (e: GlobalEvent) => void }) {
  const point = featurePoint(feature);
  if (!point) return null;
  const gid = (feature.properties as { global_id?: string }).global_id;
  const ev = onOpen3D ? featureToGlobalEvent(feature) : null;
  return (
    <>
      <Measured point={point} onOpen3D={ev && onOpen3D ? () => onOpen3D(ev) : undefined} />
      {feature.source !== 'cryosphere' && <Coverage point={point} reportHref={gid ? `/events/${encodeURIComponent(gid)}` : undefined} />}
    </>
  );
}

const BANDS = [
  { label: 'M7.0+', min: 7, color: '#ef4444' },
  { label: 'M6.0–6.9', min: 6, color: '#f97316' },
  { label: 'M5.0–5.9', min: 5, color: '#eab308' },
  { label: 'Below M5', min: 0, color: '#4ade80' },
];
const QUAKE_TYPES: EventType[] = ['tectonic', 'induced_seismicity', 'mining'];

/** Counts of the listed events that fall inside the map's current view, so the panel answers "what am I looking at?". */
export function InView({ events, box }: { events: GlobalEvent[]; box: [number, number, number, number] | null }) {
  const inside = box ? events.filter(e => e.lat >= box[1] && e.lat <= box[3] && (box[0] <= box[2] ? e.lon >= box[0] && e.lon <= box[2] : e.lon >= box[0] || e.lon <= box[2])) : events;
  const quakes = inside.filter(e => QUAKE_TYPES.includes(e.type) && e.magnitude != null);
  const biggest = quakes.reduce<GlobalEvent | null>((b, e) => (!b || (e.magnitude ?? 0) > (b.magnitude ?? 0) ? e : b), null);
  const byType = (Object.keys(EVENT_TYPE_CONFIG) as EventType[]).map(t => ({ t, n: inside.filter(e => e.type === t).length })).filter(x => x.n > 0);
  return (
    <div className="p-3 border-b border-white/10">
      <div className="flex items-center justify-between mb-2">
        <span className="panel-label">IN VIEW NOW</span>
        <span className="font-mono text-[10px] font-bold text-white">{inside.length}</span>
      </div>
      {inside.length === 0 ? (
        <p className="font-mono text-[9px] text-white/40">No events in this view for the selected period.</p>
      ) : (
        <div className="space-y-1">
          {byType.map(({ t, n }) => (
            <div key={t} className="flex justify-between items-center">
              <span className="font-mono text-[9px] flex items-center gap-1.5 text-white/70"><i style={{ width: 6, height: 6, borderRadius: '50%', background: EVENT_TYPE_CONFIG[t].color, display: 'inline-block' }} />{EVENT_TYPE_CONFIG[t].label}</span>
              <span className="font-mono text-[10px] text-white">{n}</span>
            </div>
          ))}
          {quakes.length > 0 && (
            <div className="pt-1.5 mt-1 border-t border-white/5 space-y-1">
              {BANDS.map((b, i) => {
                const n = quakes.filter(e => { const m = e.magnitude ?? 0; return i === BANDS.length - 1 ? m < 5 : m >= b.min && m < (BANDS[i - 1]?.min ?? Infinity); }).length;
                return n === 0 ? null : (
                  <div key={b.label} className="flex justify-between items-center">
                    <span className="font-mono text-[9px] flex items-center gap-1.5 text-white/55"><i style={{ width: 6, height: 6, borderRadius: '50%', background: b.color, display: 'inline-block' }} />{b.label}</span>
                    <span className="font-mono text-[10px] text-white/80">{n}</span>
                  </div>
                );
              })}
            </div>
          )}
          {biggest && <p className="font-mono text-[8px] leading-snug text-white/45 pt-1">Largest: M{(biggest.magnitude ?? 0).toFixed(1)} · {biggest.title}</p>}
        </div>
      )}
    </div>
  );
}

const utc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
function ago(ms: number) {
  const d = Math.max(0, Date.now() - ms), m = Math.floor(d / 60_000), h = Math.floor(d / 3_600_000), dd = Math.floor(d / 86_400_000);
  return m < 60 ? `${m}m ago` : h < 24 ? `${h}h ago` : dd < 365 ? `${dd}d ago` : `${Math.floor(dd / 365)}y ago`;
}
const coords = (lat: number, lon: number) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;

/** Everything known about the selected event, with measured values kept apart from modelled ones. */
export function EventDetails({ feature, full, onOpen3D, onClose }: { feature: UnifiedFeature; full: GlobalEvent | null; onOpen3D?: (e: GlobalEvent) => void; onClose: () => void }) {
  const p = feature.properties as unknown as Record<string, unknown> & { global_id?: string; source_url?: string; source_name?: string; displacement_label?: string; displacement_note?: string; headline?: string; depth_km?: number; magnitude?: number };
  const pt = featurePoint(feature);
  const type: EventType | null = full?.type ?? (feature.source === 'seismic' ? 'tectonic' : feature.source === 'volcanism' ? 'volcanic' : feature.source === 'cryosphere' ? 'cryosphere' : feature.source === 'tsunami' ? 'tsunami' : null);
  const cfg = type ? EVENT_TYPE_CONFIG[type] : null;
  const title = full?.title ?? String(p.place ?? p.name ?? p.title ?? 'Event');
  const size = p.headline ?? (feature.source === 'seismic' && p.magnitude != null ? `M ${p.magnitude.toFixed(1)}` : null);
  const depth = full?.depth ?? p.depth_km ?? null;
  const sources = full?.sources?.length ? full.sources.join(' + ') : p.source_name ?? full?.source ?? null;
  const url = full?.source_url || p.source_url || null;
  return (
    <>
      <div className="p-3 border-b border-white/10 flex items-center justify-between">
        <span className="panel-label flex items-center gap-2" style={{ color: cfg?.color }}><i style={{ width: 7, height: 7, borderRadius: '50%', background: cfg?.color ?? '#fff', display: 'inline-block' }} />{(cfg?.label ?? feature.source).toUpperCase()}</span>
        <button onClick={onClose} className="text-white/50 hover:text-white" aria-label="Clear selection">✕</button>
      </div>
      <div className="p-3 border-b border-white/10">
        <h4 className="font-mono text-sm font-bold text-white mb-1 break-words">{title}</h4>
        {size && <div className="font-mono text-[26px] font-bold leading-none mb-2" style={{ color: cfg?.color ?? '#fff' }}>{size}</div>}
        <div className="space-y-1.5">
          {pt && <Row k="TIME">{utc(pt.time)}<br /><span className="text-white/40">{ago(pt.time)}</span></Row>}
          {pt && <Row k="WHERE">{coords(pt.lat, pt.lon)}</Row>}
          {depth != null && <Row k="DEPTH">{depth.toFixed(1)} km</Row>}
          {full && <Row k="CAUSE">{full.cause === 'human' ? 'Human-made' : 'Natural'}</Row>}
          {sources && <Row k="SOURCE">{sources}</Row>}
          {p.displacement_label && <Row k="MODELLED EST.">{p.displacement_label}</Row>}
        </div>
        {p.displacement_note && <p className="font-mono text-[9px] leading-snug text-white/45 mt-2">{p.displacement_note}</p>}
        <div className="flex gap-2 mt-3">
          {p.global_id && <Link href={`/events/${encodeURIComponent(p.global_id)}`} className="tac-btn flex-1 justify-center text-center" style={{ height: 28, fontSize: 9 }}>FULL REPORT →</Link>}
          {url && <a href={url} target="_blank" rel="noreferrer" className="tac-btn justify-center text-center" style={{ height: 28, fontSize: 9, padding: '0 8px' }}>SOURCE ↗</a>}
        </div>
      </div>
      <EventNisar feature={feature} onOpen3D={onOpen3D} />
    </>
  );
}

const MAG_STEPS = [0, 4.5, 5, 6, 7];

/** The events inside the timeline's period, with the Events page's type, magnitude and search filters. */
export function EventList({ listed, inPeriod, total, period, loading, selectedId, filter, setFilter, onSelect }: {
  listed: GlobalEvent[]; inPeriod: GlobalEvent[]; total: number; period: { start: number | null; end: number }; loading: boolean;
  selectedId: string | null; filter: RadarFilter; setFilter: (f: Partial<RadarFilter>) => void; onSelect: (e: GlobalEvent) => void;
}) {
  const [limit, setLimit] = useState(80);
  const counts = new Map<EventType, number>();
  for (const e of inPeriod) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  const types = (Object.keys(EVENT_TYPE_CONFIG) as EventType[]).filter(t => counts.has(t));
  const toggle = (t: EventType) => setFilter({ types: filter.types.includes(t) ? filter.types.filter(x => x !== t) : [...filter.types, t] });
  const filtered = filter.types.length > 0 || filter.magMin > 0 || filter.search.trim() !== '';
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="p-3 border-b border-white/10 shrink-0">
        <div className="flex items-center justify-between">
          <span className="panel-label text-white">EVENTS IN PERIOD</span>
          <span className="font-mono text-[10px] font-bold text-white">{loading ? '…' : filtered ? `${listed.length} OF ${inPeriod.length}` : listed.length}</span>
        </div>
        <p className="font-mono text-[8px] leading-snug text-white/40 mt-1">
          {period.end > 0 ? `${period.start != null ? day(period.start) : '…'} → ${day(period.end)}` : '—'} · set by the timeline · {total.toLocaleString()} in the directory
        </p>
        <input
          value={filter.search} onChange={e => setFilter({ search: e.target.value })} placeholder="Search place, type or source"
          aria-label="Search events" className="w-full mt-2 font-mono text-[10px] text-white bg-black/30 border border-white/15 px-2 py-1.5 outline-none focus:border-white/40"
        />
        <div className="flex flex-wrap gap-1 mt-2">
          {types.map(t => {
            const on = filter.types.includes(t);
            return (
              <button key={t} onClick={() => toggle(t)} aria-pressed={on} className="font-mono text-[8px] tracking-wider px-1.5 py-1"
                style={{ color: on ? '#09090b' : EVENT_TYPE_CONFIG[t].color, background: on ? EVENT_TYPE_CONFIG[t].color : 'transparent', border: `1px solid ${EVENT_TYPE_CONFIG[t].color}88`, borderRadius: 2 }}>
                {EVENT_TYPE_CONFIG[t].label.toUpperCase()} {counts.get(t)}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1 mt-2">
          <span className="panel-label mr-1">MIN MAG</span>
          {MAG_STEPS.map(m => (
            <button key={m} onClick={() => setFilter({ magMin: m })} aria-pressed={filter.magMin === m} className={`tac-btn text-[9px] h-6 px-1.5 ${filter.magMin === m ? 'active' : ''}`}>{m === 0 ? 'ANY' : m}</button>
          ))}
        </div>
        {filtered && <button onClick={() => setFilter(DEFAULT_RADAR_FILTER)} className="font-mono text-[9px] mt-2" style={{ color: '#ffb28f' }}>Clear filters</button>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 pb-32 space-y-1">
        {listed.length === 0 ? (
          <p className="font-mono text-[9px] text-white/35 text-center py-6 px-3">{loading ? 'LOADING EVENTS…' : filtered ? 'NO EVENTS MATCH THESE FILTERS IN THIS PERIOD' : 'NO EVENTS IN THIS PERIOD. MOVE THE TIMELINE FORWARD OR PICK ALL.'}</p>
        ) : listed.slice(0, limit).map(e => {
          const cfg = EVENT_TYPE_CONFIG[e.type];
          const on = e.id === selectedId;
          return (
            <button key={e.id} onClick={() => onSelect(e)} aria-pressed={on} className="w-full text-left p-2 rounded border transition-colors hover:bg-white/10 bg-black/20"
              style={{ borderColor: on ? cfg.color : 'rgba(255,255,255,.06)' }}>
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="font-mono text-[9px] font-bold tracking-wider flex items-center gap-1.5" style={{ color: cfg.color }}><i style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.color, display: 'inline-block' }} />{cfg.label.toUpperCase()}</span>
                <span className="font-mono text-[9px] text-white/45">{ago(e.time)}</span>
              </div>
              <p className="font-mono text-[10px] text-white/80 truncate">{e.magnitude != null ? <b className="text-white">{e.source === 'Smithsonian GVP' ? `VEI ${Math.round(e.magnitude)}` : `M${e.magnitude.toFixed(1)}`} </b> : null}{e.title}</p>
            </button>
          );
        })}
        {listed.length > limit && <button onClick={() => setLimit(l => l + 80)} className="tac-btn w-full justify-center" style={{ height: 28, fontSize: 9 }}>SHOW {Math.min(80, listed.length - limit)} MORE</button>}
      </div>
    </div>
  );
}
