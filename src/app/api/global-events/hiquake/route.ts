/**
 * /api/global-events/hiquake – Human-Induced Earthquake Catalog
 *
 * HiQuake (Human-Induced Earthquake Database) is the most comprehensive
 * catalog of seismicity induced by human activities (mining, wastewater
 * injection, reservoir impoundment, etc.).
 *
 * Source: Foulger et al. (2018) – https://inducedearthquakes.org
 * License: freely available for research use.
 *
 * This route returns a representative static snapshot.
 */

import { NextResponse } from 'next/server';

const HIQUAKE_SNAPSHOT = {
  events: [
    // Wastewater injection / fracking
    { id: 'hq1',  title: 'Prague, Oklahoma (M5.7, wastewater injection)',         lat: 35.57,  lon: -96.77,  time: '2011-11-06', magnitude: 5.7, depth: 5,  type: 'induced_seismicity' },
    { id: 'hq2',  title: 'Raton Basin, Colorado (M5.3, wastewater injection)',    lat: 37.07,  lon: -104.74, time: '2011-08-22', magnitude: 5.3, depth: 6,  type: 'induced_seismicity' },
    { id: 'hq3',  title: 'Cushing, Oklahoma (M5.0, wastewater injection)',        lat: 35.98,  lon: -96.77,  time: '2016-11-07', magnitude: 5.0, depth: 6,  type: 'induced_seismicity' },
    { id: 'hq4',  title: 'Pawnee, Oklahoma (M5.8, wastewater injection)',         lat: 36.43,  lon: -96.93,  time: '2016-09-03', magnitude: 5.8, depth: 6,  type: 'induced_seismicity' },
    { id: 'hq5',  title: 'Sichuan fracking-induced (M6.0, hydraulic fracturing)', lat: 30.07,  lon: 104.91,  time: '2019-12-25', magnitude: 6.0, depth: 8,  type: 'induced_seismicity' },
    { id: 'hq6',  title: 'Pohang, South Korea (M5.5, geothermal EGS)',            lat: 36.11,  lon: 129.37,  time: '2017-11-15', magnitude: 5.5, depth: 5,  type: 'induced_seismicity' },
    // Mining-induced
    { id: 'hq7',  title: 'Klerksdorp, S. Africa (M5.3, gold mining)',             lat: -26.85, lon: 26.67,   time: '2005-08-09', magnitude: 5.3, depth: 3,  type: 'mining' },
    { id: 'hq8',  title: 'Rudna mine, Poland (M4.5, copper mining)',              lat: 51.47,  lon: 16.35,   time: '2016-03-07', magnitude: 4.5, depth: 2,  type: 'mining' },
    { id: 'hq9',  title: 'Saarland, Germany (M4.0, coal mine collapse)',          lat: 49.35,  lon: 6.96,    time: '2008-02-23', magnitude: 4.0, depth: 1,  type: 'mining' },
    { id: 'hq10', title: 'Hunter Valley, Australia (M3.4, coal seam gas)',        lat: -32.77, lon: 151.55,  time: '2014-09-30', magnitude: 3.4, depth: 1,  type: 'induced_seismicity' },
    // Reservoir impoundment
    { id: 'hq11', title: 'Koyna, India (M6.3, reservoir impoundment)',            lat: 17.38,  lon: 73.75,   time: '1967-12-11', magnitude: 6.3, depth: 12, type: 'induced_seismicity' },
    { id: 'hq12', title: 'Nurek, Tajikistan (M4.6, reservoir filling)',           lat: 38.38,  lon: 69.31,   time: '1972-10-01', magnitude: 4.6, depth: 8,  type: 'induced_seismicity' },
    { id: 'hq13', title: 'Three Gorges, China (M4.6, reservoir impoundment)',     lat: 30.82,  lon: 111.00,  time: '2013-12-16', magnitude: 4.6, depth: 5,  type: 'induced_seismicity' },
    // Subsidence
    { id: 'hq14', title: 'Jakarta subsidence (groundwater extraction)',            lat: -6.20,  lon: 106.82,  time: '2020-01-01', magnitude: null, depth: null, type: 'subsidence' },
    { id: 'hq15', title: 'Mexico City subsidence (clay layer compaction)',         lat: 19.43,  lon: -99.13,  time: '2021-01-01', magnitude: null, depth: null, type: 'subsidence' },
    { id: 'hq16', title: 'Po Delta subsidence, Italy (gas extraction)',            lat: 44.95,  lon: 12.40,   time: '2019-01-01', magnitude: null, depth: null, type: 'subsidence' },
    { id: 'hq17', title: 'Central Valley subsidence (groundwater)',                lat: 36.75,  lon: -119.75, time: '2022-01-01', magnitude: null, depth: null, type: 'subsidence' },
  ],
};

export async function GET() {
  return NextResponse.json(HIQUAKE_SNAPSHOT, {
    headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' },
  });
}
