# Astrophage

A real-time Earth-observation and hazard-monitoring web app built around the NASA–ISRO **NISAR** mission. It tracks
earthquakes, volcanoes, landslides, ice, tsunamis and tropical cyclones from public APIs, shows them on a 3D globe and a
2D radar map, keeps a searchable **events ledger**, and writes a short **report** for any event.

Built with Next.js 16 (App Router), React 19, Tailwind v4, three.js / react-three-fiber (globe), MapLibre + deck.gl
(radar), zustand, framer-motion. Deployed to Cloudflare Workers through `@opennextjs/cloudflare`.

> **Next.js here is not the Next.js you may know.** Read `AGENTS.md` and the guides in `node_modules/next/dist/docs/`
> before changing framework-level code.

## Quick start

```bash
npm install            # .npmrc sets legacy-peer-deps
npm run dev            # http://localhost:3000   (copies the MapLibre worker files into public/ first)
```

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev server, production build, production server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests (`src/**/*.test.ts`) |

CI (`.github/workflows/ci.yml`) runs typecheck, lint and tests on every push to `main` and every pull request.

## Pages

| Route | Content |
| --- | --- |
| `/` | Landing page |
| `/app` | Observatory: **Globe**, **Radar**, **Topo** and **Events** views, with the NISAR pass timeline |
| `/events` | Events ledger: search, filters, infinite scroll back through history, expandable rows |
| `/events/[id]` | Event report: written summary, key facts, regional map, surface displacement |

## Data sources

| Source | Used for | Route |
| --- | --- | --- |
| USGS FDSN | Earthquakes, plus PAGER / ShakeMap / DYFI detail for reports | `/api/earthquakes`, `/api/event-report` |
| NASA EONET v3 | Volcanoes, landslides, sea ice, icebergs, severe storms | `/api/global-events/eonet` |
| GDACS | Tropical cyclones (worldwide) | `/api/global-events/gdacs` |
| Smithsonian GVP | Volcanic eruptions (VEI) | `/api/global-events/gvp`, `/api/volcanism` |
| NASA COOLR, HiQuake | Landslide catalogue and human-induced seismicity (static snapshots) | `/api/global-events/coolr`, `/hiquake` |
| CelesTrak | NISAR orbital elements | `/api/orbit` |
| PTWC, NSIDC, EarthScope, Copernicus | Tsunami, sea-ice extent, GNSS stations, Sentinel-1 | `/api/tsunami`, `/cryosphere`, `/gnss`, `/sentinel` |
| Natural Earth (bundled) | Land, borders, place names for the radar basemap | `src/lib/worldVector.ts`, `src/data/places.json` |

Each source is fetched independently, so one outage never blocks the others; the ledger shows which sources are down.
Events from different sources are de-duplicated (same type, within 50 km and 24 h), and storms reported by both EONET and
GDACS are merged by name.

## What is measured and what is estimated

Be careful when quoting numbers from the app.

- **Earthquake, volcano, storm and landslide records** come straight from the sources above.
- **Surface displacement for earthquakes is modelled**, not measured: rupture size and slip come from Wells & Coppersmith
  (1994) scaling and Hanks & Kanamori moment relations, from magnitude and depth only. It is always labelled
  "modelled". Measured displacement needs InSAR or GNSS processing, which is not yet connected.
- **Storm category** is computed from maximum sustained wind with the Saffir–Simpson thresholds. Storms with no reported
  wind show "Not reported" rather than a guess.
- **The NISAR scenario overlays, pass timeline, coherence and displacement readouts on the Radar and Topo views are
  simulated demo data** (`src/lib/mockData.ts`). They are not live NISAR products.

## Environment variables

All optional; the app runs on public APIs without them.

| Variable | Purpose |
| --- | --- |
| `COPERNICUS_USER`, `COPERNICUS_PASS` | Sentinel-1 swath lookups (`/api/sentinel`) |
| `DATABASE_URL` | PostGIS store used by the SSE stream (`/api/stream`) |
| `REDIS_URL` | Pub/Sub for the SSE stream; without it the stream falls back to polling |

`db/`, `docker-compose.yml` and `services/insar-microservice/` hold the optional PostGIS and InSAR (ISCE2 / MintPy)
back end. They are not part of the Cloudflare deployment.

## Project layout

```
src/app/                 routes, API routes (src/app/api/**)
src/components/          globe, radar map, topo view, observatory shell (observatory/), UI primitives (ui/)
src/lib/                 event model and fetchers (globalEvents), event directory hook, physics, report builder,
                         storm scale, world geometry, rate limiter, zustand store
src/lib/__tests__/       unit tests
src/data/                bundled place-name data (Natural Earth, public domain)
public/                  static assets; maplibre-gl-worker/shared are copied from node_modules by `sync:maplibre`
```

## Notes for contributors

- `public/maplibre-gl-worker.mjs` and `maplibre-gl-shared.mjs` must sit side by side; `npm run dev` and `build` copy them.
- `/api/event-report` is rate limited per client (30 requests a minute). The limiter is in-memory and per instance; use
  a shared limiter if the app is exposed to heavy traffic.
- Live API response shapes (USGS PAGER, EONET, GDACS) can change; the parsers are defensive and unit-tested against
  sample shapes, but not against live responses in CI.
