/**
 * /api/global-events/gdacs – GDACS tropical-cyclone feed (UN OCHA / EU JRC Global Disaster Alert and Coordination System).
 * Returns the GeoJSON event list for tropical cyclones of the last 30 days, worldwide.
 */
import { NextResponse } from 'next/server';

const GDACS = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH';

export async function GET() {
  try {
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const now = Date.now();
    const url = `${GDACS}?eventlist=TC&fromdate=${day(now - 30 * 86400000)}&todate=${day(now)}&alertlevel=Green;Orange;Red`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(9000), next: { revalidate: 900 } });
    if (!res.ok) throw new Error(`GDACS ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=300' } });
  } catch (err) {
    console.error('[/api/global-events/gdacs]', err);
    return NextResponse.json({ features: [] }, { status: 200 });
  }
}
