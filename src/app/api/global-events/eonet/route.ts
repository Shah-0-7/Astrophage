/**
 * /api/global-events/eonet – NASA EONET v3 Proxy
 * Fetches volcanoes, landslides, earthquakes, sea/lake ice events.
 */

import { NextResponse } from 'next/server';

const EONET_BASE = 'https://eonet.gsfc.nasa.gov/api/v3/events';

export async function GET() {
  try {
    const past90 = new Date(Date.now() - 90 * 24 * 3600_000).toISOString().slice(0, 10);
    const url = `${EONET_BASE}?status=all&limit=500&start=${past90}`;
    const res = await fetch(url, { next: { revalidate: 900 } }); // 15 min
    if (!res.ok) throw new Error(`EONET ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=300' },
    });
  } catch (err) {
    console.error('[/api/global-events/eonet]', err);
    // Return empty events shape so client can still render
    return NextResponse.json({ events: [] }, { status: 200 });
  }
}
