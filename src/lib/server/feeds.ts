import { deduplicateEvents, eonetEventsFromJson, gdacsEventsFromJson, mapUSGSFeature, mergeStorms, sanitizeEvents, type GlobalEvent } from '@/lib/globalEvents';

/**
 * Server-side feed fetch for the alert job: the same upstream sources as the app, called directly (the app's own
 * /api proxies are for browsers). Each source fails independently, so one outage does not stop the others.
 */
const UA = { 'User-Agent': 'Astrophage-alerts (+https://github.com/Shah-0-7/Astrophage)', Accept: 'application/json' };
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export interface FeedResult { events: GlobalEvent[]; failed: string[] }

export async function fetchAlertFeeds(now = Date.now(), f: typeof fetch = fetch): Promise<FeedResult> {
  const get = async (url: string) => {
    const res = await f(url, { headers: UA, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  };
  const jobs: [string, () => Promise<GlobalEvent[]>][] = [
    ['USGS', async () => {
      const q = new URLSearchParams({ format: 'geojson', minmagnitude: '2.5', orderby: 'time', limit: '500', starttime: new Date(now - 48 * 3600_000).toISOString() });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((await get(`https://earthquake.usgs.gov/fdsnws/event/1/query?${q}`)).features ?? []).map((x: any) => mapUSGSFeature(x));
    }],
    ['NASA EONET', async () => eonetEventsFromJson(await get(`https://eonet.gsfc.nasa.gov/api/v3/events?status=all&limit=200&start=${day(now - 10 * 86400_000)}`))],
    ['GDACS', async () => gdacsEventsFromJson(await get(`https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&fromdate=${day(now - 10 * 86400_000)}&todate=${day(now)}&alertlevel=Green;Orange;Red`))],
  ];
  const settled = await Promise.allSettled(jobs.map(([, run]) => run()));
  const all: GlobalEvent[] = [], failed: string[] = [];
  settled.forEach((r, i) => { if (r.status === 'fulfilled') all.push(...r.value); else failed.push(jobs[i][0]); });
  return { events: deduplicateEvents(mergeStorms(sanitizeEvents(all))), failed };
}
