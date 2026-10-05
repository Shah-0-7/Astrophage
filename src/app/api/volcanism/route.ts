/**
 * /api/volcanism – Smithsonian Global Volcanism Program (GVP) Proxy
 * Ingests the weekly volcanic activity RSS feed and returns
 * thermal anomaly + aviation colour code data.
 *
 * Docs: https://volcano.si.edu/faq/index.cfm?question=weekly
 */

import { NextRequest, NextResponse } from 'next/server';
import type { VolcanismProperties, UnifiedFeature } from '@/lib/types';

const GVP_RSS = 'https://volcano.si.edu/news/WeeklyVolcanoRSS.xml';

// Curated lat/lng lookup for the most active volcanoes.
// GVP RSS lacks geo coordinates; this supplements the feed.
const VOLCANO_GEO: Record<string, [number, number]> = {
  'Etna':          [14.999, 37.748],
  'Kilauea':       [-155.287, 19.421],
  'Merapi':        [110.446, -7.542],
  'Stromboli':     [15.213, 38.789],
  'Sakurajima':    [130.657, 31.585],
  'Popocatepetl':  [-98.622, 19.023],
  'Sinabung':      [98.392, 3.170],
  'Piton de la Fournaise': [55.708, -21.244],
  'Krakatau':      [105.423, -6.102],
  'Arenal':        [-84.703, 10.462],
  'Fuego':         [-90.880, 14.473],
  'Cotopaxi':      [-78.436, -0.677],
  'Villarrica':    [-71.932, -39.422],
};

export async function GET(_req: NextRequest) {
  try {
    const res = await fetch(GVP_RSS, { next: { revalidate: 86400 } });
    if (!res.ok) throw new Error(`GVP returned ${res.status}`);
    const xml = await res.text();

    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];

    const features: UnifiedFeature[] = items.slice(0, 40).map((match, i) => {
      const item = match[1];

      const rawTitle   = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ?? item.match(/<title>(.*?)<\/title>/))?.[1] ?? '';
      const rawDesc    = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ?? item.match(/<description>(.*?)<\/description>/))?.[1] ?? '';
      const latStr     = (item.match(/<geo:lat>(.*?)<\/geo:lat>/) ?? [])[1];
      const lngStr     = (item.match(/<geo:long>(.*?)<\/geo:long>/) ?? [])[1];
      const country    = (rawTitle.match(/,\s*([^,]+)$/) ?? [])[1]?.trim() ?? '';
      const volcName   = rawTitle.split(',')[0]?.trim() ?? `Volcano-${i}`;
      const cleanDesc  = rawDesc.replace(/<[^>]+>/g, '').slice(0, 300);

      const lat = parseFloat(latStr ?? '0') || VOLCANO_GEO[volcName]?.[1] ?? 0;
      const lng = parseFloat(lngStr ?? '0') || VOLCANO_GEO[volcName]?.[0] ?? 0;

      const colorMatch = (rawTitle + rawDesc).match(/\b(RED|ORANGE|YELLOW|GREEN)\b/i);
      const aviationColor = (colorMatch?.[1]?.toUpperCase() ?? 'YELLOW') as
        'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';

      const props: VolcanismProperties = {
        volcano_id:     i,
        name:           volcName,
        country,
        aviation_color: aviationColor,
        alert_level:    aviationColor,
        last_eruption:  '',
        activity:       cleanDesc,
      };

      return {
        id:       `gvp-${i}-${volcName.replace(/\s+/g, '-').toLowerCase()}`,
        source:   'volcanism' as const,
        geometry: { type: 'Point' as const, coordinates: [lng, lat] },
        properties: props,
      };
    }).filter(f => f.geometry.coordinates[0] !== 0);

    return NextResponse.json({ type: 'volcanism', ts: Date.now(), features }, {
      headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' },
    });
  } catch (err) {
    console.error('[/api/volcanism]', err);
    return NextResponse.json({ type: 'volcanism', ts: Date.now(), features: [] });
  }
}
