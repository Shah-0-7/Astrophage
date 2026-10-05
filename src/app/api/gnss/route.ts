/**
 * /api/gnss – EarthScope / UNAVCO GNSS Station Proxy
 * Returns deformation rates for GPS benchmark stations
 * formatted as a unified GeoJSON FeatureCollection.
 *
 * Docs: https://www.earthscope.org/data/gnss-data/
 */

import { NextRequest, NextResponse } from 'next/server';
import type { GNSSProperties, UnifiedFeature } from '@/lib/types';

const UNAVCO_BASE = 'https://ws.unavco.org/ws/stations/info';

export async function GET(_req: NextRequest) {
  try {
    const res = await fetch(
      `${UNAVCO_BASE}?networks=PBO,POLAR,NUCLEUS&output=json&limit=500`,
      { next: { revalidate: 3600 } },
    );

    if (!res.ok) throw new Error(`UNAVCO returned ${res.status}`);
    const raw: any[] = await res.json();

    const features: UnifiedFeature[] = raw
      .filter(s => s.X_coordinate && s.Y_coordinate)
      .map(s => {
        const props: GNSSProperties = {
          station_id:             s.four_char_name ?? s.station_name,
          network:                s.networks ?? 'UNAVCO',
          name:                   s.station_description ?? s.four_char_name,
          deformation_rate_mm_yr: parseFloat(s.vertical_velocity ?? '0'),
          last_updated:           s.data_end ?? new Date().toISOString(),
        };
        return {
          id:       `gnss-${s.four_char_name}`,
          source:   'gnss' as const,
          geometry: {
            type:        'Point' as const,
            coordinates: [parseFloat(s.X_coordinate), parseFloat(s.Y_coordinate)],
          },
          properties: props,
        };
      });

    return NextResponse.json({ type: 'gnss', ts: Date.now(), features }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=300' },
    });
  } catch (err) {
    console.error('[/api/gnss]', err);
    // Return empty array – UI degrades gracefully
    return NextResponse.json({ type: 'gnss', ts: Date.now(), features: [] });
  }
}
