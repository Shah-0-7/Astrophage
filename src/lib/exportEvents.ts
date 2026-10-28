import type { GlobalEvent } from '@/lib/globalEvents';
import { stormOf } from '@/lib/stormScale';

const COLS = ['id', 'type', 'title', 'time_utc', 'lat', 'lon', 'magnitude', 'depth_km', 'storm_category', 'wind_kts', 'pressure_hpa', 'cause', 'source', 'source_url'] as const;

/** RFC 4180 field quoting, plus a leading apostrophe on formula-looking text so spreadsheets don't execute it. */
function field(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function row(e: GlobalEvent): Record<(typeof COLS)[number], unknown> {
  const c = e.type === 'storm' ? stormOf(e) : null;
  return {
    id: e.id, type: e.type, title: e.title, time_utc: new Date(e.time).toISOString(),
    lat: e.lat, lon: e.lon, magnitude: e.magnitude, depth_km: e.depth,
    storm_category: c ? c.full : '', wind_kts: e.wind_kts, pressure_hpa: e.pressure_mb,
    cause: e.cause, source: e.sources.join(' + '), source_url: e.source_url,
  };
}

export function eventsToCSV(events: GlobalEvent[]): string {
  const lines = [COLS.join(',')];
  for (const e of events) { const r = row(e); lines.push(COLS.map(c => field(r[c])).join(',')); }
  return lines.join('\r\n') + '\r\n';
}

/** GeoJSON FeatureCollection, coordinates [lon, lat] as the spec requires. */
export function eventsToGeoJSON(events: GlobalEvent[]) {
  return {
    type: 'FeatureCollection' as const,
    features: events.map(e => ({
      type: 'Feature' as const,
      id: e.id,
      geometry: { type: 'Point' as const, coordinates: [e.lon, e.lat] },
      properties: row(e),
    })),
  };
}

export function download(filename: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportFilename(ext: string): string {
  return `astrophage-events-${new Date().toISOString().slice(0, 10)}.${ext}`;
}
