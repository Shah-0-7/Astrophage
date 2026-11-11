#!/usr/bin/env python3
"""
auto_ingest.py - find big recent earthquakes, find a NISAR GUNW interferogram whose dates span each one, turn it into a
ground-motion grid and upload it, with no manual searching. Meant to run on a schedule (see .github/workflows/auto-grid.yml).

    python auto_ingest.py --site https://YOUR-SITE --min-mag 6 --days 45 --max-new 2
    python auto_ingest.py --site https://YOUR-SITE --dry-run          # look, but do not download or upload
    python auto_ingest.py --site https://YOUR-SITE --min-mag 5 --days 365 --limit 500 --max-new 30   # catch up on a backlog

Per event:
  1. skip it if the site already has a grid for it;
  2. ask ASF's public search API for NISAR GUNW files whose footprint contains the epicentre;
  3. keep pairs whose reference date is before the event and secondary date after it (shortest span first);
  4. read the file over HTTPS with your Earthdata token, build the grid (nisar_grid.py) and POST it to the site.

Events with no spanning pair are skipped quietly: NISAR simply has not imaged them twice yet. Each run only tries `--max-new`
new files, so a first run cannot download dozens of 1-2 GB files.

Environment: INGEST_SECRET (site upload password), EARTHDATA_TOKEN (NASA Earthdata bearer token).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Callable

import nisar_grid as ng

USGS = "https://earthquake.usgs.gov/fdsnws/event/1/query"
ASF = "https://api.daac.asf.alaska.edu/services/search/param"
UA = "astrophage-auto-ingest"

Fetch = Callable[[str], object]


def fetch_json(url: str, timeout: int = 60) -> object:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


# ------------------------------------------------------------------ events

def usgs_url(min_mag: float, days: float, now_ms: float, limit: int = 50) -> str:
    start = datetime.fromtimestamp(now_ms / 1000 - days * 86400, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    q = {"format": "geojson", "minmagnitude": f"{min_mag:g}", "starttime": start, "orderby": "magnitude", "limit": str(max(1, min(int(limit), 20000)))}
    return USGS + "?" + urllib.parse.urlencode(q)


def parse_events(data: object) -> list[dict]:
    """USGS GeoJSON to [{id,title,lon,lat,time,mag}], biggest first."""
    out = []
    for f in (data or {}).get("features", []) if isinstance(data, dict) else []:
        try:
            lon, lat = f["geometry"]["coordinates"][:2]
            p = f["properties"]
            if p.get("mag") is None or p.get("time") is None:
                continue
            out.append({"id": f.get("id", ""), "title": p.get("place") or "earthquake", "lon": float(lon), "lat": float(lat),
                        "time": float(p["time"]), "mag": float(p["mag"])})
        except (KeyError, TypeError, ValueError):
            continue
    return sorted(out, key=lambda e: -e["mag"])


def window_radius_km(mag: float) -> float:
    """Half-width of the processed window: a bigger quake moves a bigger area, and the outer ring must stay still."""
    return max(100.0, min(250.0, 50.0 * (mag - 4.5)))


# ------------------------------------------------------------------ ASF search

def asf_url(lon: float, lat: float, start_ms: float, end_ms: float) -> str:
    iso = lambda ms: datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    q = {"dataset": "NISAR", "processingLevel": "GUNW", "intersectsWith": f"POINT({lon:.4f} {lat:.4f})", "start": iso(start_ms),
         "end": iso(end_ms), "maxResults": "200", "output": "geojson"}
    return ASF + "?" + urllib.parse.urlencode(q)


def pair_of(name: str) -> tuple[float, float] | None:
    """(reference, secondary) acquisition start in epoch ms from a GUNW file name (four stamps: ref start/end, sec start/end)."""
    s = ng.parse_name(name)["stamps"]
    if len(s) >= 4:
        return s[0], s[2]
    if len(s) >= 2:
        return s[0], s[1]
    return None


def candidates(data: object) -> list[dict]:
    """Search results to [{name,url,ref,sec,bytes}] for files that look like GUNW and carry two dates."""
    feats = (data or {}).get("features", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
    out, seen = [], set()
    for f in feats:
        p = f.get("properties", f) if isinstance(f, dict) else {}
        name = p.get("fileName") or p.get("fileID") or p.get("sceneName") or ""
        url = p.get("url") or p.get("downloadUrl") or ""
        if "GUNW" not in name or not url.startswith("http") or name in seen:
            continue
        pr = pair_of(name)
        if not pr:
            continue
        seen.add(name)
        out.append({"name": name, "url": url, "ref": pr[0], "sec": pr[1], "bytes": p.get("bytes")})
    return out


def pick_pair(cands: list[dict], event_ms: float) -> dict | None:
    """The shortest pair with the reference before the event and the secondary after it."""
    spanning = [c for c in cands if c["ref"] < event_ms < c["sec"]]
    return min(spanning, key=lambda c: (c["sec"] - c["ref"], c["name"])) if spanning else None


# ------------------------------------------------------------------ site

def has_grid(site: str, ev: dict, fetch: Fetch = fetch_json) -> bool:
    q = urllib.parse.urlencode({"lat": f"{ev['lat']:.4f}", "lon": f"{ev['lon']:.4f}", "time": int(ev["time"])})
    data = fetch(f"{site.rstrip('/')}/api/displacement?{q}")
    return bool(isinstance(data, dict) and data.get("fields"))


def site_ready(site: str, fetch: Fetch = fetch_json) -> tuple[bool, str]:
    try:
        data = fetch(f"{site.rstrip('/')}/api/displacement?lat=0&lon=0&time=0")
    except Exception as e:  # noqa: BLE001 - any network failure is reported as-is
        return False, f"could not reach the site: {e}"
    if not isinstance(data, dict) or not data.get("configured"):
        return False, "the site has no database (run `npm run cf:migrate`, check the D1 binding)"
    return True, "ok"


# ------------------------------------------------------------------ processing

def process_event(ev: dict, pair: dict, *, site: str | None, ingest: str | None, earthdata: str | None, maturity: str, dry: bool) -> str:
    """Download (range-read) the file, build the grid, upload. Returns a one-line result; raises on failure."""
    with ng.open_input(pair["url"], earthdata) as h5:
        g = ng.read_gunw(h5, pair["name"], "HH")
    wire = ng.build_wire(g, center=(ev["lon"], ev["lat"]), radius_km=window_radius_km(ev["mag"]), size=192, min_coherence=0.3, maturity=maturity,
                         reference_ms=pair["ref"], secondary_ms=pair["sec"])
    if dry:
        return f"dry run: would upload {wire['id']} ({wire['nx']}x{wire['ny']})"
    if not (site and ingest):
        raise RuntimeError("need --site and INGEST_SECRET to upload")
    ng.upload(site, ingest, wire)
    return f"uploaded {wire['id']}"


def run(*, site: str, min_mag: float, days: float, max_new: int, maturity: str, dry: bool, limit: int = 50, now_ms: float | None = None,
        fetch: Fetch = fetch_json, process: Callable[..., str] = process_event, ingest: str | None = None, earthdata: str | None = None,
        log: Callable[[str], None] = print) -> dict:
    now_ms = now_ms if now_ms is not None else datetime.now(timezone.utc).timestamp() * 1000
    stats = {"events": 0, "have": 0, "no_pair": 0, "done": 0, "failed": 0}
    ok, why = site_ready(site, fetch)
    if not ok:
        log(f"STOP: {why}")
        stats["failed"] = 1
        return stats
    events = parse_events(fetch(usgs_url(min_mag, days, now_ms, limit)))
    stats["events"] = len(events)
    log(f"{len(events)} earthquakes of M{min_mag:g}+ in the last {days:g} days" + (f" (hit the limit of {limit}; raise --limit to see more)" if len(events) >= limit else ""))
    attempted = 0
    for ev in events:
        tag = f"M{ev['mag']:.1f} {ev['title']}"
        try:
            if has_grid(site, ev, fetch):
                stats["have"] += 1
                log(f"  have   {tag}")
                continue
            data = fetch(asf_url(ev["lon"], ev["lat"], ev["time"] - 120 * 86400e3, now_ms))
            pair = pick_pair(candidates(data), ev["time"])
            if not pair:
                stats["no_pair"] += 1
                log(f"  none   {tag}: no GUNW pair spans it yet")
                continue
            if attempted >= max_new:
                log(f"  later  {tag}: limit of {max_new} new files per run reached")
                continue
            attempted += 1
            log(f"  work   {tag}: {pair['name']}")
            log("         " + process(ev, pair, site=site, ingest=ingest, earthdata=earthdata, maturity=maturity, dry=dry))
            stats["done"] += 1
        except ng.AuthError as e:  # every later file would fail the same way
            stats["failed"] += 1
            log(f"  STOP   {tag}: {e}")
            break
        except (Exception, SystemExit) as e:  # noqa: BLE001 - one bad event must not stop the rest
            stats["failed"] += 1
            log(f"  FAILED {tag}: {e}")
    log(f"summary: {stats}")
    return stats


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", required=True, help="site URL, e.g. https://astrophage.shah-7.workers.dev")
    ap.add_argument("--min-mag", type=float, default=6.0)
    ap.add_argument("--days", type=float, default=45.0, help="how far back to look for earthquakes")
    ap.add_argument("--max-new", type=int, default=2, help="most new files to process in one run")
    ap.add_argument("--limit", type=int, default=50, help="most earthquakes to look at (biggest first); raise it for a low --min-mag or a long --days")
    ap.add_argument("--maturity", default="PROVISIONAL", choices=["PROVISIONAL", "BETA", "VALIDATED"])
    ap.add_argument("--dry-run", action="store_true", help="list what would be processed, still reads the files but uploads nothing")
    a = ap.parse_args(argv)
    ingest, earthdata = os.environ.get("INGEST_SECRET"), ng.clean_token(os.environ.get("EARTHDATA_TOKEN"))
    if not a.dry_run and not ingest:
        sys.exit("INGEST_SECRET is not set")
    if not earthdata:
        print("warning: EARTHDATA_TOKEN is not set; NASA will refuse the download", file=sys.stderr)
    stats = run(site=a.site, min_mag=a.min_mag, days=a.days, max_new=a.max_new, maturity=a.maturity, dry=a.dry_run, limit=a.limit, ingest=ingest, earthdata=earthdata)
    # Events without a pair are normal. A failed download or upload turns the run red so it is not mistaken for success.
    return 1 if stats["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
