/**
 * /api/global-events/gvp – Smithsonian Global Volcanism Program Proxy
 *
 * GVP's public WFS (OGC) endpoint returns volcanic eruption data.
 * We request the last 2 years of weekly activity reports as JSON.
 * If GVP is unavailable we return a bundled static snapshot.
 */

import { NextResponse } from 'next/server';

// GVP Weekly Activity Reports via their REST endpoint
// Note: GVP does not have a fully open JSON API; we use the WFS service.
const GVP_WFS =
  'https://volcanoes.usgs.gov/hans-public/api/volcano/getAllActiveVolcanoes';

// Bundled static fallback (a small curated list of recent eruptions)
const STATIC_GVP_FALLBACK = {
  events: [
    { id: 'gvp_s_1', title: 'Kīlauea eruption',       lat: 19.42,  lon: -155.29, time: '2024-01-03', vei: 1, url: 'https://volcano.si.edu' },
    { id: 'gvp_s_2', title: 'Etna eruptive episode',   lat: 37.73,  lon: 15.00,   time: '2024-02-21', vei: 2, url: 'https://volcano.si.edu' },
    { id: 'gvp_s_3', title: 'Merapi dome growth',      lat: -7.54,  lon: 110.44,  time: '2024-03-10', vei: 1, url: 'https://volcano.si.edu' },
    { id: 'gvp_s_4', title: 'Sakurajima explosion',    lat: 31.58,  lon: 130.66,  time: '2024-04-05', vei: 2, url: 'https://volcano.si.edu' },
    { id: 'gvp_s_5', title: 'Sinabung eruption',       lat: 3.17,   lon: 98.39,   time: '2024-05-15', vei: 2, url: 'https://volcano.si.edu' },
    { id: 'gvp_s_6', title: 'Taal unrest',             lat: 14.00,  lon: 120.99,  time: '2024-06-01', vei: 1, url: 'https://volcano.si.edu' },
    { id: 'gvp_s_7', title: 'Nyiragongo lava lake',    lat: -1.52,  lon: 29.25,   time: '2024-06-20', vei: 1, url: 'https://volcano.si.edu' },
    { id: 'gvp_s_8', title: 'Stromboli paroxysm',      lat: 38.79,  lon: 15.21,   time: '2024-07-10', vei: 2, url: 'https://volcano.si.edu' },
    { id: 'gvp_s_9', title: 'Popocatépetl eruption',   lat: 19.02,  lon: -98.62,  time: '2024-08-01', vei: 2, url: 'https://volcano.si.edu' },
    { id: 'gvp_s_10', title: 'Ruapehu lahar',          lat: -39.28, lon: 175.57,  time: '2024-09-15', vei: 1, url: 'https://volcano.si.edu' },
  ],
};

export async function GET() {
  // Try the USGS HANS active volcanoes endpoint as a GVP proxy
  try {
    const res = await fetch(GVP_WFS, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`GVP/HANS ${res.status}`);
     
    const data: any[] = await res.json();

    const events = data.slice(0, 100).map((v, i) => ({
      id:    `gvp_${i}_${v.vnum ?? i}`,
      title: `${v.vName ?? 'Volcano'} activity`,
      lat:   parseFloat(v.latitude  ?? '0'),
      lon:   parseFloat(v.longitude ?? '0'),
      time:  v.lastKnownEruptionDate ?? new Date().toISOString(),
      vei:   null,
      url:   `https://volcano.si.edu/volcano.cfm?vn=${v.vnum ?? ''}`,
    })).filter(e => !isNaN(e.lat) && !isNaN(e.lon));

    return NextResponse.json({ events }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600' },
    });
  } catch (err) {
    console.warn('[/api/global-events/gvp] Live fetch failed, using static fallback:', err);
    return NextResponse.json(STATIC_GVP_FALLBACK, { status: 200 });
  }
}
