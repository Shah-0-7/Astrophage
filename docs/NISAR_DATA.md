# NISAR and InSAR data

What the app shows from NASA's NISAR archive, where it comes from, and what it deliberately does not do.

## Source

NASA's **Common Metadata Repository (CMR)** is the public catalogue behind ASF DAAC and Earthdata Search. Searching it needs no login.
The app asks it for NISAR *granules* (one record per file): footprint polygon, acquisition time, product type, data maturity, and a download link.

| Collection short name | Product |
| --- | --- |
| `NISAR_L1_RSLC_*`, `NISAR_L2_GSLC_*` | Single-look complex images (not InSAR) |
| `NISAR_L2_GCOV_*` | Backscatter covariance (not InSAR) |
| `NISAR_L1_RIFG_*`, `NISAR_L1_RUNW_*`, `NISAR_L1_ROFF_*` | Radar-geometry interferogram (wrapped / unwrapped) and pixel offsets |
| `NISAR_L2_GUNW_*`, `NISAR_L2_GOFF_*` | Map-grid unwrapped interferogram and pixel offsets |
| `NISAR_L3_SME2_*` | Soil moisture |

`*` is `PROVISIONAL_V1` (calibrated, acquisitions from 17 June 2026) or `BETA_V1` (pre-calibration, Oct 2025 – Jan 2026). Both are searched.
Latency is about 36–72 hours after acquisition. Source: the [NISAR Data User Guide](https://nisar-docs.asf.alaska.edu/).

## What the app does

1. **Map layer**: `/api/nisar/granules?bbox=w,s,e,n&days=14` returns footprints for the area in view (up to 60° × 40°, 300 scenes). The radar draws them; amber marks InSAR products.
2. **Event coverage**: `/api/nisar/coverage?lat=&lon=&time=` runs two point queries against CMR and returns
   - how many scenes cover the location, the first and last date, and how many came after the event;
   - **interferogram matches**: GUNW / GOFF / RUNW / RIFG / ROFF granules whose footprint contains the event and whose pair dates
     *span* it (reference before, secondary after: "spans the event") or start after it ("after the event"). Pairs that end before the event are dropped.
3. **OPERA DISP-S1 hint**: if the location is in North America (approximate boxes) and the event is in 2016–2024, the block points to the ASF displacement portal.
   OPERA DISP-S1 is Sentinel-1, not NISAR, and a NISAR-based DISP is planned by NASA.
4. **Status check**: open `/api/nisar/status` on a deployment to confirm it can reach CMR and is getting NISAR granules.

Results are cached for 15 minutes. If CMR is down the UI says so; it never shows invented data.

## What it does not do

- It does **not download or process NISAR files**. They are large HDF5 files and need a free Earthdata Login. The displacement number on a report is still the
  *modelled* estimate (magnitude and depth scaling), and says so. Reading a GUNW file to produce a measured displacement quick-look would need a Python service
  (the repo's optional `services/insar-microservice` is a starting point) and an Earthdata token; it is not part of the Cloudflare deployment.
- "Spans the event" means the pair's dates bracket the event, so the interferogram *should* contain its ground motion. It can also contain unrelated motion
  and may be decorrelated; look at the product before drawing conclusions.
- Pair dates come from the timestamps in the granule name when it has four of them, otherwise from CMR's temporal range when that is longer than a day.
  Track, frame and direction come from the file name pattern; if a name does not match, those fields are simply omitted.
- Footprints are as published by CMR. Scenes crossing the antimeridian are handled for point tests but may draw oddly.

## Verifying against the live service

The code was written from NASA's documentation and tested against recorded-shape fixtures (`src/lib/__tests__/nisar*.test.ts`), because the build environment could not reach CMR.
After deploying, open `/api/nisar/status`. If `cmrReachable` is `true` and `nisarGranulesFound` is above 0, the query shape is right. If not, the `error` field says why,
and the first place to look is `buildGranuleUrl` in `src/lib/nisar/cmr.ts` and the field names in `parseGranules`.
