/**
 * /api/orbit – live NISAR orbital elements from CelesTrak GP data.
 * Derives altitude, period and velocity from mean-elements.
 * NISAR NORAD ID: 65053. No API key required.
 */
import { NextResponse } from 'next/server';

const CELESTRAK = 'https://celestrak.org/NORAD/elements/gp.php';
const NISAR_NORAD = '65053';
const MU = 398600.4418;   // km^3/s^2
const R_EARTH = 6378.137; // km

export async function GET() {
  try {
    const res = await fetch(`${CELESTRAK}?CATNR=${NISAR_NORAD}&FORMAT=json`, {
      next: { revalidate: 7200 }, // cache 2 hours
    });

    if (!res.ok) {
      return NextResponse.json({ error: `CelesTrak returned ${res.status}` }, { status: 502 });
    }

    const [gp] = (await res.json()) as any[];
    if (!gp) {
      return NextResponse.json({ error: 'NISAR not found in CelesTrak' }, { status: 404 });
    }

    const n    = Number(gp.MEAN_MOTION);           // rev/day
    const e    = Number(gp.ECCENTRICITY);
    const nRad = (n * 2 * Math.PI) / 86_400;       // rad/s
    const a    = Math.cbrt(MU / (nRad * nRad));    // semi-major axis km

    return NextResponse.json(
      {
        name:          gp.OBJECT_NAME,
        noradId:       gp.NORAD_CAT_ID,
        epoch:         gp.EPOCH.endsWith('Z') ? gp.EPOCH : `${gp.EPOCH}Z`,
        inclination:   Number(gp.INCLINATION),
        eccentricity:  e,
        revsPerDay:    n,
        periodMin:     1440 / n,
        altitudeKm:    a - R_EARTH,
        perigeeKm:     a * (1 - e) - R_EARTH,
        apogeeKm:      a * (1 + e) - R_EARTH,
        velocityKms:   Math.sqrt(MU / a),
        revNumber:     gp.REV_AT_EPOCH,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=7200, stale-while-revalidate=3600' } },
    );
  } catch (err) {
    console.error('[/api/orbit] fetch failed:', err);
    return NextResponse.json({ error: 'Failed to reach CelesTrak' }, { status: 502 });
  }
}
