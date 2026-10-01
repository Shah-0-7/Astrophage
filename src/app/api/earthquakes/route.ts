/**
 * ============================================================
 * /api/earthquakes - USGS FDSN Event API Proxy
 * ============================================================
 * Proxies requests to the USGS Earthquake Hazards Program
 * FDSN-WS Event API to avoid CORS issues from the browser.
 *
 * Query params forwarded:
 *   minmagnitude  - default 4.5
 *   limit         - default 200, max 2000
 *   orderby       - default "time"
 *   starttime     - ISO-8601, default 30 days ago
 *   endtime       - ISO-8601, default now
 *   format        - always "geojson"
 * ============================================================
 */

import { NextRequest, NextResponse } from 'next/server';

const USGS_BASE = 'https://earthquake.usgs.gov/fdsnws/event/1/query';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const now  = new Date();
  const past = new Date(now);
  past.setDate(past.getDate() - 30);

  const params = new URLSearchParams({
    format:       'geojson',
    minmagnitude: searchParams.get('minmagnitude') ?? '4.5',
    limit:        searchParams.get('limit')        ?? '300',
    orderby:      searchParams.get('orderby')      ?? 'time',
    starttime:    searchParams.get('starttime')    ?? past.toISOString(),
    endtime:      searchParams.get('endtime')      ?? now.toISOString(),
  });

  try {
    const res = await fetch(`${USGS_BASE}?${params.toString()}`, {
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `USGS API returned ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch (err) {
    console.error('[/api/earthquakes] fetch failed:', err);
    return NextResponse.json(
      { error: 'Failed to fetch earthquake data from USGS' },
      { status: 500 }
    );
  }
}
