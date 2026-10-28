/**
 * /api/event-report?id=usgs_us7000abcd[&title=&lat=&lon=&time=&type=&mag=&depth=&src=&url=]
 *
 * Pulls what the public APIs know about one event and turns it into a short report (see lib/eventReport).
 *   USGS earthquakes → event detail, PAGER (impact), ShakeMap (extent), DYFI (felt reports), ground failure,
 *                      moment tensor, nearby cities
 *   NASA EONET       → category, observation timeline, reported size
 *   Wikipedia        → background, only when the match is unambiguous
 * Non-USGS events need lat/lon/time/title in the query string (the directory sends them).
 */
import { NextRequest, NextResponse } from 'next/server';
import { clientKey, rateLimit } from '@/lib/rateLimit';
import type { EventType, GlobalEvent } from '@/lib/globalEvents';
import {
  buildReport, type EonetIntel, type NearbyPlace, type QuakeIntel, type ReportSource, type WikiIntel,
} from '@/lib/eventReport';

 

const UA = { 'User-Agent': 'Astrophage-EventReport/1.0 (+https://github.com/Shah-0-7/Astrophage)', Accept: 'application/json' };
const TYPES: EventType[] = ['tectonic', 'volcanic', 'landslide', 'cryosphere', 'subsidence', 'mining', 'induced_seismicity', 'tsunami', 'storm'];

async function getJson(url: string, ms = 7000): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms), next: { revalidate: 600 } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** Only follow product links that point at USGS itself. */
function usgsUrl(u: unknown): string | null {
  if (typeof u !== 'string') return null;
  try { const url = new URL(u); return url.protocol === 'https:' && url.hostname.endsWith('usgs.gov') ? url.toString() : null; } catch { return null; }
}

function product(products: any, key: string): any | null {
  const arr = products?.[key];
  if (!Array.isArray(arr)) return null;
  return arr.find((p: any) => p?.status !== 'DELETE') ?? arr[0] ?? null;
}
function content(prod: any, suffix: string): string | null {
  const c = prod?.contents;
  if (!c) return null;
  const k = Object.keys(c).find(key => key.endsWith(suffix));
  return k ? usgsUrl(c[k]?.url) : null;
}
const asNum = (v: unknown): number | null => { const n = typeof v === 'string' ? parseFloat(v) : (v as number); return typeof n === 'number' && isFinite(n) ? n : null; };
const asAlert = (v: unknown): string | null => (typeof v === 'string' && /^(green|yellow|orange|red)$/i.test(v) ? v.toLowerCase() : null);

function mechanismFromRake(rake: number | null): string | null {
  if (rake == null) return null;
  if (rake >= 45 && rake <= 135) return 'Reverse / thrust';
  if (rake <= -45 && rake >= -135) return 'Normal';
  return 'Strike-slip';
}

async function usgsIntel(rawId: string): Promise<{ event: GlobalEvent | null; intel: QuakeIntel | null; ok: boolean }> {
  const detail = await getJson(`https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=${encodeURIComponent(rawId)}&format=geojson`);
  if (!detail?.properties) return { event: null, intel: null, ok: false };
  const p = detail.properties, prods = p.products ?? {};
  const [lon, lat, depth] = detail.geometry?.coordinates ?? [NaN, NaN, null];

  const event: GlobalEvent = {
    id: `usgs_${rawId}`, type: 'tectonic', cause: 'natural', title: p.place ?? 'Earthquake', lat, lon,
    time: p.time, magnitude: p.mag ?? null, depth: depth ?? null, displacement_cm: null,
    source: 'USGS', source_url: p.url ?? 'https://earthquake.usgs.gov', sources: ['USGS'],
  };

  const pager = product(prods, 'losspager');
  const shake = product(prods, 'shakemap');
  const dyfi = product(prods, 'dyfi');
  const gf = product(prods, 'ground-failure');
  const mt = product(prods, 'moment-tensor') ?? product(prods, 'focal-mechanism');
  const nb = product(prods, 'nearby-cities');

  const [losses, exposures, comments, cities] = await Promise.all([
    content(pager, 'losses.json') ? getJson(content(pager, 'losses.json')!) : null,
    content(pager, 'exposures.json') ? getJson(content(pager, 'exposures.json')!) : null,
    content(pager, 'comments.json') ? getJson(content(pager, 'comments.json')!) : null,
    content(nb, 'nearby-cities.json') ? getJson(content(nb, 'nearby-cities.json')!) : null,
  ]);

  // PAGER prose about expected damage and secondary hazards
  const pagerComments: string[] = [];
  if (comments && typeof comments === 'object') {
    for (const k of ['impact1', 'impact2', 'struct_comment', 'secondary_comment']) {
      const v = (comments as any)[k];
      if (typeof v === 'string' && v.trim()) pagerComments.push(v.trim());
    }
  }

  // people exposed to MMI VI+
  let exposed: number | null = null;
  const pe = exposures?.population_exposure;
  if (pe && Array.isArray(pe.mmi) && Array.isArray(pe.aggregated_exposure) && pe.mmi.length === pe.aggregated_exposure.length) {
    exposed = pe.mmi.reduce((sum: number, m: number, i: number) => (m >= 6 ? sum + (Number(pe.aggregated_exposure[i]) || 0) : sum), 0);
  }

  // ShakeMap grid extent
  let shakeArea: number | null = null;
  const sp = shake?.properties ?? {};
  const [minLat, maxLat, minLon, maxLon] = [asNum(sp['minimum-latitude']), asNum(sp['maximum-latitude']), asNum(sp['minimum-longitude']), asNum(sp['maximum-longitude'])];
  if (minLat != null && maxLat != null && minLon != null && maxLon != null && maxLat > minLat && maxLon > minLon) {
    const mid = ((minLat + maxLat) / 2) * Math.PI / 180;
    shakeArea = (maxLat - minLat) * 111.32 * (maxLon - minLon) * 111.32 * Math.cos(mid);
  }

  const gfp = gf?.properties ?? {};
  const findAlert = (word: string) => {
    const k = Object.keys(gfp).find(key => key.includes(word) && key.includes('alert') && asAlert(gfp[key]));
    return k ? asAlert(gfp[k]) : null;
  };

  const nearby: NearbyPlace[] = Array.isArray(cities)
    ? cities.slice(0, 5).map((c: any) => ({ name: String(c.name), distanceKm: Number(c.distance), direction: String(c.direction ?? ''), population: asNum(c.population) }))
        .filter(c => isFinite(c.distanceKm))
    : [];

  const intel: QuakeIntel = {
    magType: p.magType ?? null,
    status: p.status ?? null,
    felt: p.felt ?? asNum(dyfi?.properties?.numResp),
    cdi: p.cdi ?? asNum(dyfi?.properties?.maxmmi),
    mmi: p.mmi ?? asNum(sp.maxmmi),
    alert: asAlert(p.alert) ?? asAlert(pager?.properties?.alertlevel),
    fatalityAlert: asAlert(losses?.empirical_fatality?.alert),
    economicAlert: asAlert(losses?.empirical_economic?.alert),
    pagerComments,
    exposedMmi6Plus: exposed,
    shakemapAreaKm2: shakeArea,
    maxPga: asNum(sp.maxpga),
    tsunami: p.tsunami === 1,
    sig: p.sig ?? null,
    landslideAlert: findAlert('landslide'),
    liquefactionAlert: findAlert('liquefaction'),
    mechanism: mechanismFromRake(asNum(mt?.properties?.['nodal-plane-1-rake'])),
    nearby,
  };
  return { event, intel, ok: true };
}

async function eonetIntel(rawId: string): Promise<EonetIntel | null> {
  const j = await getJson(`https://eonet.gsfc.nasa.gov/api/v3/events/${encodeURIComponent(rawId)}`);
  if (!j) return null;
  const geos: any[] = Array.isArray(j.geometry) ? j.geometry : [];
  const dates = geos.map(g => g.date).filter(Boolean).sort();
  const withMag = geos.filter(g => g.magnitudeValue != null).pop();
  return {
    categories: (j.categories ?? []).map((c: any) => c.title).filter(Boolean),
    closed: j.closed ?? null,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    observations: geos.length,
    magnitudeValue: withMag ? asNum(withMag.magnitudeValue) : null,
    magnitudeUnit: withMag?.magnitudeUnit ?? null,
    sources: (j.sources ?? []).map((s: any) => ({ id: s.id, url: s.url })),
    description: j.description ?? null,
  };
}

/** Wikipedia background – returned only when the page clearly matches this event (name overlap and the year). */
async function wikiIntel(event: GlobalEvent, quake: boolean): Promise<WikiIntel | null> {
  const year = new Date(event.time).getUTCFullYear();
  const bare = event.title.replace(/\(.*?\)/g, '').replace(/\b(activity|eruption|eruptive episode|landslides?|mudslides?|mudflows?)\b/gi, '').trim();
  const q = quake ? `${year} ${bare.replace(/^\d+\s*km\s+\w+\s+of\s+/i, '')} earthquake` : bare;
  const search = await getJson(`https://en.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(q)}&limit=3`, 5000);
  const pages: any[] = search?.pages ?? [];
  const tokens = bare.toLowerCase().split(/[\s,]+/).filter(w => w.length >= 4 && !/^(near|south|north|east|west|region|island|islands)$/.test(w));
  for (const pg of pages) {
    const title: string = pg.title ?? '';
    const sum = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, 5000);
    const extract: string = sum?.extract ?? '';
    if (!extract || sum?.type === 'disambiguation') continue;
    const hay = `${title} ${extract}`.toLowerCase();
    const nameHit = tokens.some(tk => hay.includes(tk));
    const yearHit = extract.includes(String(year)) || title.includes(String(year));
    if (quake ? (nameHit && yearHit && /earthquake/i.test(hay)) : (nameHit && (yearHit || event.time < Date.UTC(year, 0, 2)))) {
      return { title, extract, url: sum.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}` };
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  // Each report fans out to several upstream APIs, so keep one client from hammering it.
  const limit = rateLimit(clientKey(req), 30, 60_000);
  if (!limit.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } });
  const sp = new URL(req.url).searchParams;
  const id = (sp.get('id') ?? '').slice(0, 200);
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const sources: ReportSource[] = [];
  let event: GlobalEvent | null = null;
  let quake: QuakeIntel | null = null;
  let eonet: EonetIntel | null = null;

  // Event passed by the directory (needed for sources that cannot be looked up by id)
  const lat = Number(sp.get('lat')), lon = Number(sp.get('lon')), time = Number(sp.get('time'));
  const type = sp.get('type') as EventType | null;
  if (isFinite(lat) && isFinite(lon) && isFinite(time) && sp.get('lat') !== null) {
    const mag = sp.get('mag'), dep = sp.get('depth');
    event = {
      id, type: type && TYPES.includes(type) ? type : 'tectonic', cause: sp.get('cause') === 'human' ? 'human' : 'natural',
      title: (sp.get('title') ?? 'Event').slice(0, 200), lat, lon, time,
      magnitude: mag !== null && mag !== '' && isFinite(Number(mag)) ? Number(mag) : null,
      depth: dep !== null && dep !== '' && isFinite(Number(dep)) ? Number(dep) : null,
      displacement_cm: null,
      ...(type === 'storm' ? (() => {
        const w = Number(sp.get('wind')), pr = Number(sp.get('pres'));
        let track: [number, number, number?][] | undefined;
        try { const t = JSON.parse(sp.get('track') ?? '[]'); if (Array.isArray(t)) track = t.filter((p: unknown) => Array.isArray(p) && isFinite(Number(p[0])) && isFinite(Number(p[1]))).slice(-12).map((p: number[]) => (isFinite(Number(p[2])) ? [Number(p[0]), Number(p[1]), Number(p[2])] : [Number(p[0]), Number(p[1])]) as [number, number, number?]); } catch { /* ignore */ }
        return { wind_kts: sp.get('wind') && isFinite(w) ? w : null, pressure_mb: sp.get('pres') && isFinite(pr) ? pr : null, track };
      })() : {}),
      source: (sp.get('src') ?? 'Unknown').slice(0, 60), source_url: sp.get('url') ?? '', sources: [(sp.get('src') ?? 'Unknown').slice(0, 60)],
    };
  }

  if (id.startsWith('usgs_')) {
    const raw = id.slice(5);
    const r = await usgsIntel(raw);
    sources.push({ name: 'USGS Earthquake Hazards Program', url: `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(raw)}`, ok: r.ok, note: r.ok ? undefined : 'detail unavailable – using directory data' });
    if (r.event) event = r.event;
    quake = r.intel;
  } else if (id.startsWith('eonet_')) {
    const m = /^eonet_(EONET_\d+)/.exec(id);
    if (m) {
      eonet = await eonetIntel(m[1]);
      sources.push({ name: 'NASA EONET', url: `https://eonet.gsfc.nasa.gov/api/v3/events/${m[1]}`, ok: !!eonet });
    }
  }

  if (!event) return NextResponse.json({ error: 'Event not found. Open it from the event directory.' }, { status: 404 });

  const isQuake = event.type === 'tectonic' && id.startsWith('usgs_');
  const wiki = (!isQuake || (event.magnitude ?? 0) >= 6.5) ? await wikiIntel(event, isQuake) : null;
  if (wiki) sources.push({ name: 'Wikipedia', url: wiki.url, ok: true });
  if (!sources.length && event.source_url) sources.push({ name: event.source, url: event.source_url, ok: true });

  const report = buildReport({ event, quake, eonet, wiki, sources });
  return NextResponse.json(report, { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300' } });
}
