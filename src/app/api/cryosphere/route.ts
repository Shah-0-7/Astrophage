/**
 * /api/cryosphere – NSIDC Sea-Ice Extent Proxy
 * Fetches the latest daily sea-ice extent data for both
 * hemispheres from the NSIDC MASIE or G02135 dataset.
 *
 * Docs: https://nsidc.org/data/g02135
 */

import { NextRequest, NextResponse } from 'next/server';
import type { CryosphereProperties, UnifiedFeature } from '@/lib/types';

// NSIDC MASIE extent CSV endpoint (no auth required)
const NSIDC_CSV = 'https://masie_web.apps.nsidc.org/pub/DATASETS/NOAA/G02186/masie_4km_allyears_extent_sqkm.csv';

export async function GET(_req: NextRequest) {
  try {
    const res = await fetch(NSIDC_CSV, { next: { revalidate: 86400 } });
    if (!res.ok) throw new Error(`NSIDC returned ${res.status}`);
    const text = await res.text();

    // CSV columns: yyyyddd, (regional extents...)
    const lines = text.trim().split('\n').filter(l => l.trim() && !l.startsWith('#'));
    const header = lines[0].split(',').map(h => h.trim());
    const last = lines[lines.length - 1].split(',');

    // Total Northern Hemisphere extent is column index 1 in MASIE
    const dateStr  = last[0]?.trim() ?? '';
    const yearDoy  = dateStr.length === 7
      ? `${dateStr.slice(0, 4)}-DOY${dateStr.slice(4)}`
      : dateStr;

    const totalIdx = header.findIndex(h => h.toLowerCase().includes('total'));
    const extentSqKm = totalIdx >= 0 ? parseFloat(last[totalIdx] ?? '0') * 1000 : 0;

    // Approximate 1981–2010 median for anomaly calculation
    const MEDIAN_N_1981_2010 = 12_190_000; // sq km (Sept minimum median)
    const anomaly = extentSqKm - MEDIAN_N_1981_2010;

    const props: CryosphereProperties = {
      date:         yearDoy,
      hemisphere:   'N',
      extent_sq_km: extentSqKm,
      anomaly_sq_km: anomaly,
    };

    // Approximate Arctic bounding polygon for visualisation
    const features: UnifiedFeature[] = [{
      id:     `nsidc-N-${dateStr}`,
      source: 'cryosphere' as const,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[
          [-180, 65], [180, 65], [180, 90], [-180, 90], [-180, 65]
        ]],
      },
      properties: props,
    }];

    return NextResponse.json({ type: 'cryosphere', ts: Date.now(), features }, {
      headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' },
    });
  } catch (err) {
    console.error('[/api/cryosphere]', err);
    return NextResponse.json({ type: 'cryosphere', ts: Date.now(), features: [] });
  }
}
