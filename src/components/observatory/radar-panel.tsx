'use client';

/**
 * Real-data blocks for the radar page's side panel: what NISAR has measured at the selected event, what NASA's catalogue says
 * NISAR has imaged there, and what is inside the current map view. Everything here is read from the site or from a catalogue;
 * nothing is simulated, and measured values are kept visibly apart from modelled ones.
 */

import Link from 'next/link';
import type { UnifiedFeature } from '@/lib/types';
import type { GlobalEvent } from '@/lib/globalEvents';
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
  { label: 'M4.5–4.9', min: 0, color: '#4ade80' },
];

/** Counts of the feed's events inside the map's current view, so the panel answers "what am I looking at?". */
export function InView({ events, box }: { events: UnifiedFeature[]; box: [number, number, number, number] | null }) {
  const inside = box ? events.filter(f => {
    if (f.geometry.type !== 'Point') return false;
    const [lon, lat] = f.geometry.coordinates as [number, number];
    return lat >= box[1] && lat <= box[3] && (box[0] <= box[2] ? lon >= box[0] && lon <= box[2] : lon >= box[0] || lon <= box[2]);
  }) : events;
  const quakes = inside.filter(f => f.source === 'seismic');
  const mags = quakes.map(f => (f.properties as { magnitude: number }).magnitude);
  const biggest = quakes.reduce<UnifiedFeature | null>((b, f) => (!b || (f.properties as { magnitude: number }).magnitude > (b.properties as { magnitude: number }).magnitude ? f : b), null);
  const count = (src: string) => inside.filter(f => f.source === src).length;
  return (
    <div className="p-3 border-b border-white/10">
      <div className="flex items-center justify-between mb-2">
        <span className="panel-label">IN VIEW NOW</span>
        <span className="font-mono text-[10px] font-bold text-white">{inside.length}</span>
      </div>
      {inside.length === 0 ? (
        <p className="font-mono text-[9px] text-white/40">No events in this view for the selected time window.</p>
      ) : (
        <div className="space-y-1">
          {quakes.length > 0 && BANDS.map((b, i) => {
            const n = mags.filter(m => (i === BANDS.length - 1 ? m < 5 : m >= b.min && m < (BANDS[i - 1]?.min ?? Infinity))).length;
            return n === 0 ? null : (
              <div key={b.label} className="flex justify-between items-center">
                <span className="font-mono text-[9px] flex items-center gap-1.5 text-white/70"><i style={{ width: 6, height: 6, borderRadius: '50%', background: b.color, display: 'inline-block' }} />{b.label}</span>
                <span className="font-mono text-[10px] text-white">{n}</span>
              </div>
            );
          })}
          {([['volcanism', 'Volcanic'], ['tsunami', 'Tsunami / alerts'], ['cryosphere', 'Ice updates']] as const).map(([src, label]) => count(src) > 0 && (
            <div key={src} className="flex justify-between items-center">
              <span className="font-mono text-[9px] text-white/70">{label}</span>
              <span className="font-mono text-[10px] text-white">{count(src)}</span>
            </div>
          ))}
          {biggest && (
            <p className="font-mono text-[8px] leading-snug text-white/45 pt-1 border-t border-white/5">
              Largest: M{(biggest.properties as { magnitude: number }).magnitude.toFixed(1)} · {(biggest.properties as { place?: string }).place ?? 'earthquake'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
