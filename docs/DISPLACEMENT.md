# Measured ground motion (NISAR GUNW) in the Topo view

The Topo view can draw **measured** NISAR ground motion on real terrain. It is opt-in per event: a grid exists only after
someone has processed an interferogram for that event. Nothing here is modelled; where there is no grid the view says so.

## What you see

Open an earthquake or volcano in the **Events** ledger and press **OPEN IN 3D**.

- **Terrain**: real elevation (AWS Terrain Tiles, via `/api/terrain`), not the procedural scene.
- **Colour**: line-of-sight (LOS) change in cm between the interferogram's two dates. Red = toward the satellite, blue = away.
  **Fringes** mode repeats the colour every half wavelength (11.9 cm) like a wrapped interferogram.
- **Reading**: hover or click the surface for elevation, LOS change and coherence at that point.
- No grid yet: the view shows the terrain, says nothing has been processed, and gives the command to process the first
  interferogram NASA's catalogue lists for the event.

The classic procedural Topo scene (opened from the tab bar) is unchanged and its readouts remain labelled **ESTIMATED**.

## What the numbers mean (and don't)

- LOS is not vertical motion. One geometry cannot separate up from sideways.
- An interferogram has no absolute zero. The processor subtracts the median of the outer ring of the window, so the map is
  relative to its surroundings. A very large signal that fills the window is partly removed: use a bigger `--radius-km`.
- No troposphere, ionosphere or solid-earth-tide correction, and no unwrapping-error repair. A few cm of smooth gradient can be noise.
- Pixels with coherence below the threshold (default 0.3), water, or invalid subswaths are dropped.
- Products are PROVISIONAL or BETA, not VALIDATED.

## One-time setup (Cloudflare deployment)

1. **Migration**: `npm run cf:migrate` (adds the `displacement_fields` table; migration `0002`).
2. **Secret**: pick a long random string and set it on the Worker as `INGEST_SECRET`
   (Cloudflare dashboard → Workers & Pages → astrophage → Settings → Variables and Secrets, type *Secret*, or `npx wrangler secret put INGEST_SECRET`).
3. Redeploy (`npm run cf:deploy`). Local runs: put `INGEST_SECRET` in `.dev.vars`.

## Making a grid

You need a NISAR **GUNW** file (map-grid unwrapped interferogram). Find one from the event's *NISAR observations* block (it lists
pairs that span the event) or on [ASF Search](https://search.asf.alaska.edu/). Downloading needs a free NASA Earthdata login;
create a token at <https://urs.earthdata.nasa.gov/profile> (*Generate Token*) and export it as `EARTHDATA_TOKEN`.

```bash
cd tools/nisar-grid
pip install -r requirements.txt
export INGEST_SECRET=...            # the same value as on the Worker
export EARTHDATA_TOKEN=...
python nisar_grid.py https://datapool.asf.alaska.edu/.../NISAR_L2_PR_GUNW_....h5 \
  --center 86.5,28.0 --radius-km 120 --upload https://astrophage.shah-7.workers.dev
```

Add `--dry-run --out grid.json` to write the grid without uploading. A downloaded file works too: pass its path instead of a URL.

## Automatic mode (no searching per event)

`tools/nisar-grid/auto_ingest.py` does the manual steps for you. For each earthquake of magnitude 6 or more in the last 45 days it
1. skips the event if the site already has a grid for it;
2. asks ASF's public search API (`api.daac.asf.alaska.edu/services/search/param`, no login) for NISAR GUNW files that contain the epicentre;
3. keeps a pair whose reference date is before the event and whose secondary date is after it (shortest span first);
4. reads that file with your Earthdata token, builds the grid and uploads it.

Events with no spanning pair are skipped; they are tried again on the next run. Each run processes at most `--max-new` (default 2) new files.

**On a schedule:** the workflow *Auto-process NISAR interferograms* runs every 6 hours. Add the secrets `INGEST_SECRET` and `EARTHDATA_TOKEN` and the
variable `SITE_URL` (same as for the manual workflow), then Actions → *Auto-process NISAR interferograms* → Run workflow once with **dry run** ticked to see what it finds.
**By hand:** `python auto_ingest.py --site https://YOUR-SITE --dry-run`.

Earthdata tokens expire after about 60 days. When the job starts failing with 401/403, make a new token and update the secret.

### Without a local Python setup: GitHub Actions

Repository → Settings → Secrets and variables → Actions: add secrets `INGEST_SECRET` and `EARTHDATA_TOKEN`, and the variable `SITE_URL`.
Then Actions → *Process NISAR interferogram* → Run workflow, and fill in the file link and the event's `lon,lat`.

## Storage and API

- A grid is at most 256 × 256 int16 cells at 0.1 cm steps (about 175 KB as JSON), stored in D1 table `displacement_fields`.
- `GET /api/displacement?lat=&lon=&time=` lists grids that contain the point and whose date pair spans `time`; `?id=` returns one.
- `POST /api/displacement/ingest` stores one (`Authorization: Bearer $INGEST_SECRET`); `DELETE ?id=` removes one.
- The wire format is defined in `src/lib/displacement/field.ts` and written by `tools/nisar-grid/nisar_grid.py`; a shared fixture test keeps the two in step.

## Verify on a real file first

The processor was built from the documented GUNW layout and tested on synthetic files, because the build environment cannot reach
NASA. Before trusting a map, check it against ASF's own quick-look for the same product (sign, location, size of the signal), and
confirm the sign convention in the product's `phase` documentation. If the mask layer removes almost everything the processor ignores it and says so in the grid's notes.
