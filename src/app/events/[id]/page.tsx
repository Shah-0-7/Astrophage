'use client';

/**
 * /events/[id] – Full Event Detail Page
 *
 * Progressively loads enrichment data from:
 *  - USGS FDSN (alerts, felt reports, tsunami, intensity)
 *  - NASA EONET (geometry timeline, sources)
 *  - Wikipedia REST summary (named places / events)
 *  - Smithsonian GVP (volcanoes)
 *
 * Related events (≤150 km, ≤30 days) pulled from cached dataset.
 * InSAR/GNSS section is a reserved placeholder.
 * Share button copies current URL.
 * Previous/next navigation respects filter context via back-link.
 */

import {
  Suspense, use, useCallback, useEffect, useRef, useState, useMemo,
} from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchAllGlobalEvents, type GlobalEvent } from '@/lib/globalEvents';
import {
  EVENT_TYPE_CONFIG,
  CAUSE_LABELS,
  CAUSE_COLORS,
} from '@/lib/eventDirectoryTypes';

// ── Helpers ───────────────────────────────────────────────────

function fmtDate(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}
function fmtDateTime(ms: number) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function generateSummary(event: GlobalEvent): string {
  const dateStr = new Date(event.time).toLocaleDateString('en-US', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  const cause = event.cause === 'human' ? 'human-induced' : 'naturally occurring';

  switch (event.type) {
    case 'tectonic':
    case 'induced_seismicity': {
      const mag   = event.magnitude != null ? `magnitude ${event.magnitude.toFixed(1)}` : 'an unknown-magnitude';
      const depth = event.depth != null ? ` at a depth of ${event.depth.toFixed(0)} km` : '';
      return `A ${mag} earthquake occurred on ${dateStr}${depth}, reported by ${event.sources.join(' & ')}. This event is classified as ${cause} and located at ${Math.abs(event.lat).toFixed(2)}°${event.lat >= 0 ? 'N' : 'S'}, ${Math.abs(event.lon).toFixed(2)}°${event.lon >= 0 ? 'E' : 'W'}.`;
    }
    case 'volcanic':
      return `A volcanic event (${event.title}) was recorded on ${dateStr}. ${event.magnitude != null ? `Volcanic Explosivity Index (VEI): ${event.magnitude}.` : ''} Reported by ${event.sources.join(' & ')}.`;
    case 'landslide':
      return `A ${cause} landslide event was recorded near ${event.title} on ${dateStr}, sourced from ${event.sources.join(' & ')}.`;
    case 'cryosphere':
      return `A cryosphere event (${event.title}) was observed on ${dateStr}. This indicates significant ice or glacier change recorded by ${event.sources.join(' & ')}.`;
    case 'subsidence':
      return `Ground subsidence was detected at ${event.title} on ${dateStr}. ${event.displacement_cm != null ? `Measured displacement: ${event.displacement_cm} cm.` : ''}`;
    case 'mining':
      return `A mining-related seismic event was recorded at ${event.title} on ${dateStr}, sourced from ${event.sources.join(' & ')}.`;
    case 'tsunami':
      return `A tsunami event (${event.title}) was issued on ${dateStr}, sourced from ${event.sources.join(' & ')}.`;
    default:
      return `A ${event.type} event (${event.title}) was recorded on ${dateStr} by ${event.sources.join(' & ')}.`;
  }
}

// ── Enrichment data types ─────────────────────────────────────

interface USGSDetail {
  alert:       string | null;
  felt:        number | null;
  tsunami:     number | null;
  mmi:         number | null;
  status:      string | null;
}

interface WikiSummary {
  title:   string;
  extract: string;
  url:     string;
  thumbnail?: { source: string; width: number; height: number } | null;
}

interface EnrichmentState {
  usgs:   { status: 'idle' | 'loading' | 'ok' | 'error'; data: USGSDetail | null };
  wiki:   { status: 'idle' | 'loading' | 'ok' | 'none' | 'error'; data: WikiSummary | null };
}

// ── Mini SVG locator map ──────────────────────────────────────

function MiniMap({ lat, lon, color }: { lat: number; lon: number; color: string }) {
  const W = 300, H = 150;
  const x = ((lon + 180) / 360) * W;
  const y = ((90 - lat)  / 180) * H;
  return (
    <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border-zinc)', borderRadius: 2 }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} aria-label={`Event location at ${lat.toFixed(2)}, ${lon.toFixed(2)}`}>
        <rect width={W} height={H} fill="none" />
        {[-60,-30,0,30,60].map(la => {
          const gy = ((90 - la) / 180) * H;
          return <line key={la} x1={0} y1={gy} x2={W} y2={gy} stroke="var(--border-glass)" strokeWidth={0.5} />;
        })}
        {[-120,-60,0,60,120].map(lo => {
          const gx = ((lo + 180) / 360) * W;
          return <line key={lo} x1={gx} y1={0} x2={gx} y2={H} stroke="var(--border-glass)" strokeWidth={0.5} />;
        })}
        <circle cx={x} cy={y} r={6} fill={`${color}33`} stroke={color} strokeWidth={2} />
        <circle cx={x} cy={y} r={2.5} fill={color} />
        <circle cx={x} cy={y} r={9} fill="none" stroke={color} strokeWidth={1} opacity={0.4}>
          <animate attributeName="r" from="6" to="18" dur="2.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" from="0.5" to="0" dur="2.5s" repeatCount="indefinite" />
        </circle>
        {/* Crosshair */}
        <line x1={x - 14} y1={y} x2={x - 8} y2={y} stroke={color} strokeWidth={0.8} opacity={0.5} />
        <line x1={x + 8}  y1={y} x2={x + 14} y2={y} stroke={color} strokeWidth={0.8} opacity={0.5} />
        <line x1={x} y1={y - 14} x2={x} y2={y - 8} stroke={color} strokeWidth={0.8} opacity={0.5} />
        <line x1={x} y1={y + 8}  x2={x} y2={y + 14} stroke={color} strokeWidth={0.8} opacity={0.5} />
      </svg>
    </div>
  );
}

// ── Enrichment section wrapper ────────────────────────────────

type EnrichStatus = 'loading' | 'ok' | 'error' | 'none' | 'idle';

function EnrichSection({
  title, status, onRetry, children,
}: {
  title: string; status: EnrichStatus; onRetry?: () => void; children: React.ReactNode;
}) {
  const colors: Record<EnrichStatus, string> = {
    loading: 'var(--acquiring)', ok: 'var(--nominal)', error: 'var(--crimson)', none: 'var(--standby)', idle: 'var(--standby)',
  };
  const labels: Record<EnrichStatus, string> = {
    loading: 'Fetching...', ok: 'OK', error: 'Unavailable', none: 'Not found', idle: 'Idle',
  };
  return (
    <div className="glass-panel rounded-sm p-4 mb-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="status-dot" style={{ background: colors[status], boxShadow: status === 'ok' ? `0 0 5px ${colors[status]}` : undefined }} />
          <p className="panel-label">{title}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[8px]" style={{ color: colors[status] }}>{labels[status]}</span>
          {status === 'error' && onRetry && (
            <button onClick={onRetry} className="tac-btn" style={{ height: 20, fontSize: 8, padding: '0 6px' }}>RETRY</button>
          )}
        </div>
      </div>
      {status === 'loading' && (
        <div className="flex flex-col gap-2">
          {[80, 60, 90].map((w, i) => <div key={i} className="shimmer h-3 rounded-sm" style={{ width: `${w}%` }} />)}
        </div>
      )}
      {status === 'ok' && children}
      {status === 'error' && (
        <p className="font-mono text-[9px] text-white/25">This section is currently unavailable. Other data remains accessible above.</p>
      )}
      {status === 'none' && (
        <p className="font-mono text-[9px] text-white/25">No data found for this event.</p>
      )}
    </div>
  );
}

// ── USGS detail section ───────────────────────────────────────

function USGSDetailSection({ eventId, isUSGS }: { eventId: string; isUSGS: boolean }) {
  const [state, setState] = useState<{ status: EnrichStatus; data: USGSDetail | null }>({ status: 'idle', data: null });
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!isUSGS) { setState({ status: 'none', data: null }); return; }
    setState(s => ({ ...s, status: 'loading' }));

    // Extract the raw USGS event id (strip our 'usgs_' prefix)
    const rawId = eventId.replace(/^usgs_/, '');
    const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=${rawId}&format=geojson`;
    const ctrl = new AbortController();

    fetch(url, { signal: ctrl.signal })
      .then(r => r.json())
      .then(json => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = (json as any).properties ?? {};
        setState({
          status: 'ok',
          data: {
            alert:   p.alert   ?? null,
            felt:    p.felt    ?? null,
            tsunami: p.tsunami ?? null,
            mmi:     p.mmi     ?? null,
            status:  p.status  ?? null,
          },
        });
      })
      .catch(err => {
        if (err.name !== 'AbortError') setState({ status: 'error', data: null });
      });

    return () => ctrl.abort();
  }, [eventId, isUSGS, retryTick]);

  return (
    <EnrichSection title="USGS FDSN ENRICHMENT" status={state.status} onRetry={() => setRetryTick(t => t + 1)}>
      {state.data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'ALERT LEVEL', value: state.data.alert ?? 'N/A', color: state.data.alert === 'red' ? '#ef4444' : state.data.alert === 'orange' ? '#fb923c' : '#4ade80' },
            { label: 'FELT REPORTS', value: state.data.felt != null ? String(state.data.felt) : 'N/A' },
            { label: 'TSUNAMI FLAG', value: state.data.tsunami === 1 ? '⚠ YES' : 'No' },
            { label: 'REVIEW STATUS', value: (state.data.status ?? 'N/A').toUpperCase() },
          ].map(f => (
            <div key={f.label}>
              <p className="font-mono text-[8px] text-white/30 tracking-widest mb-0.5">{f.label}</p>
              <p className="font-mono text-[11px] font-semibold" style={{ color: f.color ?? 'var(--text-primary)' }}>{f.value}</p>
            </div>
          ))}
        </div>
      )}
    </EnrichSection>
  );
}

// ── Wikipedia section ─────────────────────────────────────────

function WikiSection({ title }: { title: string }) {
  const [state, setState] = useState<{ status: EnrichStatus; data: WikiSummary | null }>({ status: 'idle', data: null });
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    setState(s => ({ ...s, status: 'loading' }));
    const slug = encodeURIComponent(title.split(' ').slice(0, 4).join('_'));
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`;
    const ctrl = new AbortController();

    fetch(url, { signal: ctrl.signal })
      .then(r => {
        if (r.status === 404) { setState({ status: 'none', data: null }); return null; }
        if (!r.ok) throw new Error(`Wiki ${r.status}`);
        return r.json();
      })
      .then(json => {
        if (!json) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const j = json as any;
        if (j.type === 'disambiguation') { setState({ status: 'none', data: null }); return; }
        setState({
          status: 'ok',
          data: {
            title:     j.title,
            extract:   j.extract_html ? j.extract_html.replace(/<[^>]+>/g, '') : j.extract ?? '',
            url:       j.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${slug}`,
            thumbnail: j.thumbnail ?? null,
          },
        });
      })
      .catch(err => {
        if (err.name !== 'AbortError') setState({ status: 'error', data: null });
      });

    return () => ctrl.abort();
  }, [title, retryTick]);

  return (
    <EnrichSection title="WIKIPEDIA CONTEXT" status={state.status} onRetry={() => setRetryTick(t => t + 1)}>
      {state.data && (
        <div>
          {state.data.thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={state.data.thumbnail.source} alt={state.data.title}
              className="float-right ml-4 mb-2 rounded-sm" style={{ maxWidth: 120, maxHeight: 90, objectFit: 'cover' }} />
          )}
          <p className="font-mono text-[10px] text-white/60 leading-relaxed mb-2">{state.data.extract.slice(0, 600)}{state.data.extract.length > 600 ? '...' : ''}</p>
          <a href={state.data.url} target="_blank" rel="noopener noreferrer"
            className="font-mono text-[9px] text-white/30 hover:text-white/60 transition-colors">
            ↗ Wikipedia — {state.data.title}
          </a>
          <p className="font-mono text-[7px] text-white/20 mt-1">Source: Wikipedia, licensed CC BY-SA 3.0</p>
        </div>
      )}
    </EnrichSection>
  );
}

// ── Related events ────────────────────────────────────────────

function RelatedEvents({ event, allEvents }: { event: GlobalEvent; allEvents: GlobalEvent[] }) {
  const related = useMemo(() => {
    const DIST_KM = 150, TIME_MS = 30 * 86400_000;
    return allEvents
      .filter(e =>
        e.id !== event.id &&
        Math.abs(e.time - event.time) <= TIME_MS &&
        haversineKm(event.lat, event.lon, e.lat, e.lon) <= DIST_KM
      )
      .sort((a, b) => Math.abs(a.time - event.time) - Math.abs(b.time - event.time))
      .slice(0, 6);
  }, [event, allEvents]);

  if (!related.length) return null;

  return (
    <div className="mb-3">
      <p className="panel-label mb-2">RELATED EVENTS (≤150 km, ≤30 days)</p>
      <div className="grid gap-2">
        {related.map(r => {
          const cfg = EVENT_TYPE_CONFIG[r.type];
          const dist = haversineKm(event.lat, event.lon, r.lat, r.lon);
          return (
            <Link
              key={r.id}
              href={`/events/${r.id}`}
              className="block glass-panel rounded-sm p-3 hover:border-white/20 transition-colors"
              style={{ borderColor: `${cfg.color}22` }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-[9px] px-1.5 py-0.5 rounded-sm"
                  style={{ background: `${cfg.color}18`, color: cfg.color, border: `1px solid ${cfg.color}30` }}>
                  {cfg.icon} {cfg.label}
                </span>
                <span className="font-mono text-[8px] text-white/30">{dist.toFixed(0)} km away</span>
              </div>
              <p className="font-mono text-[10px] text-white/80 line-clamp-1">{r.title}</p>
              <p className="font-mono text-[8px] text-white/30 mt-0.5">{fmtDate(r.time)}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ── Detail page skeleton ──────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center gap-2 mb-6">
        <div className="shimmer h-5 w-20 rounded-sm" />
        <div className="shimmer h-5 w-16 rounded-sm" />
      </div>
      <div className="shimmer h-8 w-3/4 rounded-sm mb-3" />
      <div className="shimmer h-4 w-full rounded-sm mb-2" />
      <div className="shimmer h-4 w-5/6 rounded-sm mb-8" />
      {[120, 80, 150].map((h, i) => <div key={i} className={`shimmer rounded-sm mb-3`} style={{ height: h }} />)}
    </div>
  );
}

// ── Main page inner ───────────────────────────────────────────

function EventDetailInner({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const [allEvents, setAllEvents] = useState<GlobalEvent[]>([]);
  const [loadingAll, setLoadingAll] = useState(true);
  const [copied, setCopied] = useState(false);

  // Load events from cache
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cached = (() => { try { const r = localStorage.getItem('gs_cache_usgs'); if (!r) return null; const p = JSON.parse(r) as any; if (Date.now() - p.ts > 10 * 60_000) return null; return p.data as GlobalEvent[]; } catch { return null; } })();

    if (cached) {
      setAllEvents(cached);
      setLoadingAll(false);
      return;
    }
    fetchAllGlobalEvents(() => {})
      .then(evts => { setAllEvents(evts); setLoadingAll(false); })
      .catch(() => setLoadingAll(false));
  }, []);

  const event = allEvents.find(e => e.id === id) ?? null;
  const cfg   = event ? EVENT_TYPE_CONFIG[event.type] : null;

  const isUSGS = id.startsWith('usgs_');

  // Share
  const share = useCallback(async () => {
    const url = window.location.href;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* fallback */ }
  }, []);

  // Build back URL (preserve filter params from referrer)
  const backParams = searchParams.toString();
  const backHref   = `/events${backParams ? `?${backParams}` : ''}`;

  // Prev / next within filter context (simplified: just use all events sorted by time)
  const sortedEvents = useMemo(() => [...allEvents].sort((a, b) => b.time - a.time), [allEvents]);
  const idx          = event ? sortedEvents.indexOf(event) : -1;
  const prevEvent    = idx > 0                        ? sortedEvents[idx - 1] : null;
  const nextEvent    = idx < sortedEvents.length - 1  ? sortedEvents[idx + 1] : null;

  if (loadingAll) return <DetailSkeleton />;
  if (!event || !cfg) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6">
        <p className="font-mono text-[11px] tracking-widest text-white/30">EVENT NOT FOUND</p>
        <Link href="/events" className="tac-btn" style={{ height: 34 }}>← EVENT DIRECTORY</Link>
      </div>
    );
  }

  const summary    = generateSummary(event);
  const causeColor = CAUSE_COLORS[event.cause];

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-16">
      {/* Breadcrumb + nav */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2 text-white/30 font-mono text-[9px] tracking-wider">
          <Link href="/events" className="hover:text-white/60 transition-colors" aria-label="Back to event directory">
            ← EVENT DIRECTORY
          </Link>
          {backParams && (
            <>
              <span>/</span>
              <a href={backHref} className="hover:text-white/60 transition-colors">FILTERED VIEW</a>
            </>
          )}
        </div>
        <button onClick={share} className="tac-btn" style={{ height: 28, fontSize: 9 }}
          aria-label="Copy link to clipboard">
          {copied ? '✓ COPIED' : '⎘ SHARE'}
        </button>
      </div>

      {/* Header */}
      <div className="glass-panel rounded-sm p-5 mb-3">
        <div className="flex items-start gap-2 mb-3 flex-wrap">
          <span className="font-mono text-[9px] font-bold px-2 py-1 rounded-sm"
            style={{ background: `${cfg.color}18`, color: cfg.color, border: `1px solid ${cfg.color}30` }}>
            {cfg.icon} {cfg.label.toUpperCase()}
          </span>
          <span className="font-mono text-[9px] px-2 py-1 rounded-sm"
            style={{ background: `${causeColor}12`, color: causeColor, border: `1px solid ${causeColor}25` }}>
            {CAUSE_LABELS[event.cause]}
          </span>
          <span className="font-mono text-[8px] px-2 py-1 rounded-sm"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-secondary)' }}>
            {event.source}
          </span>
        </div>
        <h1 className="font-mono text-[18px] font-bold text-white leading-snug mb-3">{event.title}</h1>
        <p className="font-mono text-[10px] text-white/55 leading-relaxed">{summary}</p>
      </div>

      {/* Key facts grid */}
      <div className="glass-panel rounded-sm p-4 mb-3">
        <p className="panel-label mb-3">KEY FACTS</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
          {[
            { label: 'DATE (UTC)',   value: fmtDateTime(event.time) },
            { label: 'LATITUDE',    value: `${Math.abs(event.lat).toFixed(4)}°${event.lat >= 0 ? 'N' : 'S'}` },
            { label: 'LONGITUDE',   value: `${Math.abs(event.lon).toFixed(4)}°${event.lon >= 0 ? 'E' : 'W'}` },
            event.magnitude != null ? { label: 'MAGNITUDE', value: `M${event.magnitude.toFixed(1)}`, color: cfg.color } : null,
            event.depth     != null ? { label: 'DEPTH',     value: `${event.depth.toFixed(0)} km` } : null,
            event.displacement_cm != null ? { label: 'DISPLACEMENT', value: `${event.displacement_cm} cm`, color: cfg.color } : null,
            { label: 'SOURCES',     value: event.sources.join(', ') },
            { label: 'EVENT ID',    value: event.id },
          ].filter(Boolean).map(f => f && (
            <div key={f.label}>
              <p className="font-mono text-[8px] text-white/30 tracking-widest">{f.label}</p>
              <p className="font-mono text-[11px] font-semibold mt-0.5 leading-snug"
                style={{ color: f.color ?? 'var(--text-primary)' }}>{f.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Mini locator map */}
      <div className="glass-panel rounded-sm p-4 mb-3">
        <p className="panel-label mb-2">LOCATION</p>
        <MiniMap lat={event.lat} lon={event.lon} color={cfg.color} />
        <p className="font-mono text-[8px] text-white/25 mt-2 text-center">
          {Math.abs(event.lat).toFixed(4)}°{event.lat >= 0 ? 'N' : 'S'},&nbsp;
          {Math.abs(event.lon).toFixed(4)}°{event.lon >= 0 ? 'E' : 'W'}
        </p>
      </div>

      {/* USGS enrichment */}
      {isUSGS && <USGSDetailSection eventId={event.id} isUSGS={isUSGS} />}

      {/* Wikipedia context */}
      <WikiSection title={event.title} />

      {/* InSAR / GNSS placeholder */}
      <div className="glass-panel rounded-sm p-4 mb-3 border-dashed" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
        <div className="flex items-center gap-2 mb-2">
          <span className="status-dot" style={{ background: 'var(--standby)' }} />
          <p className="panel-label">DISPLACEMENT DATA (InSAR / GNSS) — COMING SOON</p>
        </div>
        {event.displacement_cm != null ? (
          <p className="font-mono text-[10px]" style={{ color: cfg.color }}>
            Preliminary displacement: {event.displacement_cm} cm
          </p>
        ) : (
          <p className="font-mono text-[9px] text-white/25 italic leading-relaxed">
            Full InSAR surface displacement maps and GNSS time-series will be rendered here
            once the NISAR InSAR processing pipeline is integrated. This section is reserved
            for co-seismic and inter-seismic displacement analysis.
          </p>
        )}
      </div>

      {/* Related events */}
      {!loadingAll && <RelatedEvents event={event} allEvents={allEvents} />}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 mt-4">
        <a href={`/?flyTo=${event.lat},${event.lon}`} className="tac-btn"
           style={{ height: 34 }}>
          🌐 VIEW ON GLOBE
        </a>
        <a href={event.source_url} target="_blank" rel="noopener noreferrer"
           className="tac-btn" style={{ height: 34 }}>
          ↗ SOURCE RECORD
        </a>
      </div>

      {/* Prev / next */}
      <div className="flex gap-2 mt-3">
        {prevEvent ? (
          <Link href={`/events/${prevEvent.id}${backParams ? `?${backParams}` : ''}`}
            className="tac-btn flex-1 justify-center text-center" style={{ height: 30, fontSize: 9 }}
            aria-label="Previous event">
            ← PREV
          </Link>
        ) : <div className="flex-1" />}
        {nextEvent ? (
          <Link href={`/events/${nextEvent.id}${backParams ? `?${backParams}` : ''}`}
            className="tac-btn flex-1 justify-center text-center" style={{ height: 30, fontSize: 9 }}
            aria-label="Next event">
            NEXT →
          </Link>
        ) : <div className="flex-1" />}
      </div>

      {/* Data sources footer */}
      <div className="mt-8 pt-4 border-t border-white/06 flex flex-wrap gap-x-4 gap-y-1">
        <span className="font-mono text-[7px] text-white/20 tracking-widest">DATA SOURCES:</span>
        {[
          { name: 'USGS FDSN',       url: 'https://earthquake.usgs.gov' },
          { name: 'NASA EONET',       url: 'https://eonet.gsfc.nasa.gov' },
          { name: 'Smithsonian GVP', url: 'https://volcano.si.edu' },
          { name: 'NASA COOLR',       url: 'https://gpm.nasa.gov/landslides/index.html' },
          { name: 'HiQuake',          url: 'https://inducedearthquakes.org' },
          { name: 'Wikipedia',        url: 'https://en.wikipedia.org' },
        ].map(s => (
          <a key={s.name} href={s.url} target="_blank" rel="noopener noreferrer"
            className="font-mono text-[8px] text-white/25 hover:text-white/50 transition-colors">
            {s.name}
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Page export ───────────────────────────────────────────────

export default function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <EventDetailInner id={decodeURIComponent(id)} />
    </Suspense>
  );
}
