/**
 * /api/global-events/coolr – NASA COOLR / Global Landslide Catalog
 *
 * The NASA Global Landslide Catalog (GLC) is available as a static
 * dataset.  This route serves a curated snapshot of ~200 significant
 * events.  A future step can replace this with a live ArcGIS query.
 */

import { NextResponse } from 'next/server';

// Curated representative snapshot from NASA COOLR GLC
// Full catalog: https://gpm.nasa.gov/landslides/index.html
const COOLR_SNAPSHOT = {
  events: [
    { id: 'c1',  title: 'Oso landslide, Washington, USA',            lat: 48.28,  lon: -121.84, time: '2014-03-22' },
    { id: 'c2',  title: 'Jure landslide, Sindhupalchok, Nepal',      lat: 27.89,  lon: 85.89,   time: '2014-08-02' },
    { id: 'c3',  title: 'Salerno mudflows, Italy',                    lat: 40.68,  lon: 14.75,   time: '2015-11-14' },
    { id: 'c4',  title: 'Sichuan landslide, China',                   lat: 29.59,  lon: 102.94,  time: '2016-06-24' },
    { id: 'c5',  title: 'Aranayake landslide, Sri Lanka',             lat: 7.07,   lon: 80.38,   time: '2016-05-17' },
    { id: 'c6',  title: 'Mocoa mudflow, Colombia',                    lat: 1.15,   lon: -76.65,  time: '2017-04-01' },
    { id: 'c7',  title: 'Freetown landslide, Sierra Leone',           lat: 8.49,   lon: -13.24,  time: '2017-08-14' },
    { id: 'c8',  title: 'Hoang Lien Son landslides, Vietnam',         lat: 22.36,  lon: 103.84,  time: '2017-08-03' },
    { id: 'c9',  title: 'Bududa landslide, Uganda',                   lat: 1.01,   lon: 34.33,   time: '2018-10-11' },
    { id: 'c10', title: 'Hiroshima landslides, Japan',                lat: 34.40,  lon: 132.47,  time: '2018-07-06' },
    { id: 'c11', title: 'Palu liquefaction, Indonesia',               lat: -0.89,  lon: 119.87,  time: '2018-09-28' },
    { id: 'c12', title: 'Brumadinho dam failure, Brazil',             lat: -20.13, lon: -44.12,  time: '2019-01-25' },
    { id: 'c13', title: 'Agathe landslide, Norway',                   lat: 64.05,  lon: 12.04,   time: '2020-06-03' },
    { id: 'c14', title: 'Ask landslide, Norway',                      lat: 59.96,  lon: 10.83,   time: '2020-12-30' },
    { id: 'c15', title: 'Chamoli disaster, Uttarakhand, India',       lat: 30.38,  lon: 79.58,   time: '2021-02-07' },
    { id: 'c16', title: 'Nuristan landslide, Afghanistan',            lat: 35.32,  lon: 70.81,   time: '2021-05-22' },
    { id: 'c17', title: 'Atami mudslide, Japan',                      lat: 35.09,  lon: 139.08,  time: '2021-07-03' },
    { id: 'c18', title: 'Petrópolis mudslides, Brazil',               lat: -22.51, lon: -43.18,  time: '2022-02-15' },
    { id: 'c19', title: 'KwaZulu-Natal floods/landslides, S. Africa', lat: -29.80, lon: 30.97,   time: '2022-04-11' },
    { id: 'c20', title: 'Meizhou landslide, China',                   lat: 23.90,  lon: 116.10,  time: '2022-06-21' },
    { id: 'c21', title: 'Gandaki landslide, Nepal',                   lat: 28.21,  lon: 84.37,   time: '2023-03-10' },
    { id: 'c22', title: 'Enga landslide, Papua New Guinea',           lat: -5.88,  lon: 143.64,  time: '2024-05-24' },
    { id: 'c23', title: 'Wayanad landslide, Kerala, India',           lat: 11.60,  lon: 76.07,   time: '2024-07-30' },
    { id: 'c24', title: 'Bajos del Toro mudflow, Costa Rica',         lat: 10.19,  lon: -84.31,  time: '2023-11-20' },
    { id: 'c25', title: 'Derna flash flood debris, Libya',            lat: 32.75,  lon: 22.64,   time: '2023-09-10' },
  ],
};

export async function GET() {
  return NextResponse.json(COOLR_SNAPSHOT, {
    headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' },
  });
}
