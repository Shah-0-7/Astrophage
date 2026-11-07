#!/usr/bin/env python3
"""
nisar_grid.py - turn a NISAR GUNW (geocoded unwrapped interferogram) file into a small ground-motion grid for Astrophage.

    python nisar_grid.py NISAR_L2_PR_GUNW_....h5 --center 86.5,28.0 --radius-km 120 --dry-run --out grid.json
    python nisar_grid.py https://datapool.asf.alaska.edu/.../NISAR_L2_PR_GUNW_....h5 --upload https://YOUR-SITE --token $INGEST_SECRET

What it does
  1. Reads unwrapped phase, coherence and the product mask (HDF5 paths below) and the UTM grid coordinates.
  2. Converts phase to line-of-sight (LOS) change in cm:  cm = -phase * wavelength / (4*pi) * 100  (positive = toward the satellite).
  3. Drops pixels with low coherence, water, no-data or invalid subswaths; crops to a window around an event (optional).
  4. Removes the median of the outer ring so the map is relative to its surroundings (an interferogram has no absolute zero).
  5. Block-averages, resamples onto a regular lon/lat grid (at most 256 x 256) and writes / uploads the compact JSON that
     src/lib/displacement/field.ts reads.

Not done: no troposphere, ionosphere or solid-earth-tide correction (the product carries layers for them but they are not
applied here), no unwrapping-error repair, no vertical/horizontal split. The output says so in `notes`.
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

import numpy as np

BASE = "science/LSAR/GUNW/grids/frequencyA/unwrappedInterferogram"
MAX_DIM = 256
SCALE_CM = 0.1
NODATA = -32768
MAX_ABS_CM = 3276
# NISAR L-band centre frequency is about 1.2575 GHz; used only when the file does not carry its own.
DEFAULT_WAVELENGTH_M = 299_792_458.0 / 1.2575e9

NAME_RE = re.compile(r"^NISAR_L\d_[A-Z]{2}_[A-Z0-9]{4}_(\d{3})_(\d{3})_([AD])_(\d{3})_")
STAMP_RE = re.compile(r"(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})")


# --------------------------------------------------------------------------- conversions

def phase_to_los_cm(phase_rad: np.ndarray, wavelength_m: float = DEFAULT_WAVELENGTH_M) -> np.ndarray:
    """Unwrapped phase (radians) to LOS change in cm, positive toward the satellite.

    Convention (ISCE3 / ARIA / MintPy): interferogram = reference x conj(secondary), so a positive phase is a range
    increase (motion away from the satellite): d_toward = -phase * wavelength / (4 pi). CONFIRM this sign against the
    first real product you process (docs/DISPLACEMENT.md).
    """
    return (-phase_rad.astype("float64") * wavelength_m / (4.0 * math.pi) * 100.0).astype("float32")


def mask_ok(mask: np.ndarray) -> np.ndarray:
    """Product mask: fill value 255; otherwise a 3-digit code = 100*water + 10*reference_subswath + secondary_subswath.
    A pixel is usable when it is not fill, not water, and both subswath digits are non-zero."""
    m = mask.astype("int64")
    water = (m // 100) % 10 == 1
    ref_sub = (m // 10) % 10
    sec_sub = m % 10
    return (m != 255) & ~water & (ref_sub != 0) & (sec_sub != 0)


def valid_pixels(phase: np.ndarray, coh: np.ndarray | None, mask: np.ndarray | None, min_coherence: float) -> tuple[np.ndarray, list[str]]:
    notes: list[str] = []
    ok = np.isfinite(phase)
    if coh is not None:
        ok &= np.isfinite(coh) & (coh >= min_coherence)
    if mask is not None:
        mk = mask_ok(mask)
        kept = ok & mk
        # The mask digit layout is taken from NASA-linked documentation; if it would wipe out nearly everything that is
        # otherwise good, assume the layout is not what we think and ignore the mask rather than return an empty map.
        if ok.sum() > 0 and kept.sum() < 0.01 * ok.sum():
            notes.append("product mask ignored (it rejected >99% of coherent pixels, layout not as expected)")
        else:
            ok = kept
    return ok, notes


def block_mean(values: np.ndarray, valid: np.ndarray, f: int, min_fraction: float = 0.5) -> np.ndarray:
    """Mean of the valid pixels in each f x f block; NaN where fewer than min_fraction of the block is valid."""
    if f <= 1:
        return np.where(valid, values, np.nan).astype("float32")
    ny, nx = values.shape
    py, px = (-ny) % f, (-nx) % f
    v = np.pad(np.where(valid, values, 0.0).astype("float64"), ((0, py), (0, px)))
    c = np.pad(valid.astype("float64"), ((0, py), (0, px)))
    by, bx = v.shape[0] // f, v.shape[1] // f
    s = v.reshape(by, f, bx, f).sum(axis=(1, 3))
    n = c.reshape(by, f, bx, f).sum(axis=(1, 3))
    with np.errstate(invalid="ignore", divide="ignore"):
        out = np.where(n >= min_fraction * f * f, s / n, np.nan)
    return out.astype("float32")


def remove_reference_level(grid: np.ndarray, ring_fraction: float = 0.15, min_pixels: int = 50) -> tuple[np.ndarray, float | None]:
    """Subtract the median of the outer ring (the far field), falling back to the whole-grid median."""
    ny, nx = grid.shape
    ry, rx = max(1, int(ny * ring_fraction)), max(1, int(nx * ring_fraction))
    ring = np.ones_like(grid, dtype=bool)
    ring[ry:ny - ry, rx:nx - rx] = False
    vals = grid[ring & np.isfinite(grid)]
    if vals.size < min_pixels:
        vals = grid[np.isfinite(grid)]
    if vals.size == 0:
        return grid, None
    ref = float(np.median(vals))
    return (grid - ref).astype("float32"), ref


# --------------------------------------------------------------------------- reading

def parse_name(name: str) -> dict:
    base = os.path.basename(name)
    base = re.sub(r"\.(h5|hdf5)$", "", base, flags=re.I)
    out: dict = {"id": base, "stamps": [datetime(*map(int, m), tzinfo=timezone.utc).timestamp() * 1000 for m in STAMP_RE.findall(base)]}
    m = NAME_RE.match(base)
    if m:
        out.update(track=int(m.group(2)), direction=m.group(3), frame=int(m.group(4)))
    return out


def _text(v) -> str | None:
    if isinstance(v, bytes):
        return v.decode("utf-8", "ignore")
    if isinstance(v, np.ndarray) and v.shape == ():
        return _text(v[()])
    return v if isinstance(v, str) else None


def _iso_ms(s: str | None) -> float | None:
    if not s:
        return None
    try:
        t = datetime.fromisoformat(s.strip().replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return t.timestamp() * 1000
    except ValueError:
        return None


def read_gunw(h5, source_name: str, pol: str = "HH") -> dict:
    """Read what we need from an open h5py.File. Raises KeyError with the missing path if the layout differs."""
    def get(path):
        if path not in h5:
            raise KeyError(f"{path} not found in the file. Is this a NISAR GUNW product (and does it have polarisation {pol})?")
        return h5[path]

    phase = get(f"{BASE}/{pol}/unwrappedPhase")[()].astype("float32")
    coh = get(f"{BASE}/{pol}/coherenceMagnitude")[()].astype("float32") if f"{BASE}/{pol}/coherenceMagnitude" in h5 else None
    mask = get(f"{BASE}/mask")[()] if f"{BASE}/mask" in h5 else None
    x = get(f"{BASE}/xCoordinates")[()].astype("float64")
    y = get(f"{BASE}/yCoordinates")[()].astype("float64")

    proj = get(f"{BASE}/projection")
    epsg = proj.attrs.get("epsg_code", None)
    if epsg is None:
        epsg = proj[()]
    epsg = int(np.asarray(epsg).reshape(-1)[0])

    wavelength = DEFAULT_WAVELENGTH_M
    for p in ("science/LSAR/GUNW/grids/frequencyA/centerFrequency", "science/LSAR/GUNW/metadata/radarBand/centerFrequency"):
        if p in h5:
            f = float(np.asarray(h5[p][()]).reshape(-1)[0])
            if 1.0e9 < f < 2.0e9:
                wavelength = 299_792_458.0 / f
                break

    info = parse_name(source_name)
    ident = h5["science/LSAR/identification"] if "science/LSAR/identification" in h5 else None
    ref_ms = sec_ms = None
    if len(info["stamps"]) >= 4:
        a, b = info["stamps"][0], info["stamps"][2]
        ref_ms, sec_ms = min(a, b), max(a, b)
    elif ident is not None:
        ref_ms = _iso_ms(_text(ident.get("referenceZeroDopplerStartTime")[()]) if "referenceZeroDopplerStartTime" in ident else None)
        sec_ms = _iso_ms(_text(ident.get("secondaryZeroDopplerStartTime")[()]) if "secondaryZeroDopplerStartTime" in ident else None)
    track, frame, direction = info.get("track"), info.get("frame"), info.get("direction")
    if ident is not None:
        if track is None and "trackNumber" in ident:
            track = int(np.asarray(ident["trackNumber"][()]).reshape(-1)[0])
        if frame is None and "frameNumber" in ident:
            frame = int(np.asarray(ident["frameNumber"][()]).reshape(-1)[0])
        if direction is None and "orbitPassDirection" in ident:
            d = (_text(ident["orbitPassDirection"][()]) or "")[:1].upper()
            direction = d if d in ("A", "D") else None
    return dict(id=info["id"], phase=phase, coh=coh, mask=mask, x=x, y=y, epsg=epsg, wavelength=wavelength,
                reference=ref_ms, secondary=sec_ms, track=track, frame=frame, direction=direction)


# --------------------------------------------------------------------------- processing

def build_wire(g: dict, *, center: tuple[float, float] | None = None, radius_km: float | None = None, size: int = 192,
               min_coherence: float = 0.3, maturity: str = "PROVISIONAL", reference_ms: float | None = None,
               secondary_ms: float | None = None, with_coherence: bool = True) -> dict:
    from pyproj import Transformer

    size = int(min(max(size, 8), MAX_DIM))
    ref_ms = reference_ms if reference_ms is not None else g["reference"]
    sec_ms = secondary_ms if secondary_ms is not None else g["secondary"]
    if ref_ms is None or sec_ms is None:
        raise ValueError("Could not find the reference/secondary dates in the file name or metadata. Pass --reference and --secondary (ISO 8601).")
    if sec_ms < ref_ms:
        ref_ms, sec_ms = sec_ms, ref_ms

    to_xy = Transformer.from_crs(4326, g["epsg"], always_xy=True)
    to_ll = Transformer.from_crs(g["epsg"], 4326, always_xy=True)
    x, y = g["x"], g["y"]
    dx, dy = float(x[1] - x[0]), float(y[1] - y[0])

    # crop
    c0, c1, r0, r1 = 0, len(x), 0, len(y)
    if center is not None and radius_km:
        cx, cy = to_xy.transform(center[0], center[1])
        r = radius_km * 1000.0
        cols = np.where(np.abs(x - cx) <= r)[0]
        rows = np.where(np.abs(y - cy) <= r)[0]
        if cols.size == 0 or rows.size == 0:
            raise ValueError("The event location is outside this interferogram's frame.")
        c0, c1, r0, r1 = int(cols[0]), int(cols[-1]) + 1, int(rows[0]), int(rows[-1]) + 1
    sl = (slice(r0, r1), slice(c0, c1))
    phase, coh = g["phase"][sl], (g["coh"][sl] if g["coh"] is not None else None)
    mask = g["mask"][sl] if g["mask"] is not None else None
    xs, ys = x[c0:c1], y[r0:r1]

    cm = phase_to_los_cm(phase, g["wavelength"])
    ok, notes = valid_pixels(phase, coh, mask, min_coherence)
    if not ok.any():
        raise ValueError("No usable pixels (all below the coherence threshold or masked). Try --min-coherence 0.1.")

    f = max(1, int(round(max(cm.shape) / float(size))))
    blocks = block_mean(cm, ok, f)
    cohb = block_mean(coh, ok, f) if (coh is not None and with_coherence) else None
    blocks, ref_level = remove_reference_level(blocks)
    if ref_level is None:
        raise ValueError("No usable pixels after block averaging.")

    # lon/lat extent of the window (edges densified so the curved UTM box is covered)
    xe = np.array([xs[0] - dx / 2, xs[-1] + dx / 2]); ye = np.array([ys[0] - dy / 2, ys[-1] + dy / 2])
    ex = np.concatenate([np.linspace(xe[0], xe[1], 41), np.linspace(xe[0], xe[1], 41), np.full(41, xe[0]), np.full(41, xe[1])])
    ey = np.concatenate([np.full(41, ye[0]), np.full(41, ye[1]), np.linspace(ye[0], ye[1], 41), np.linspace(ye[0], ye[1], 41)])
    lon_e, lat_e = to_ll.transform(ex, ey)
    west, east, south, north = float(np.min(lon_e)), float(np.max(lon_e)), float(np.min(lat_e)), float(np.max(lat_e))
    if east - west > 10 or north - south > 10:
        raise ValueError("Window larger than 10 degrees. Use --center and --radius-km to crop.")
    if east - west <= 0 or north - south <= 0:
        raise ValueError("Degenerate window.")

    ratio = (east - west) * math.cos(math.radians((south + north) / 2)) / (north - south)
    nx_o, ny_o = (size, max(2, round(size / ratio))) if ratio >= 1 else (max(2, round(size * ratio)), size)
    nx_o, ny_o = min(nx_o, MAX_DIM), min(ny_o, MAX_DIM)

    lons = west + (np.arange(nx_o) + 0.5) * (east - west) / nx_o
    lats = north - (np.arange(ny_o) + 0.5) * (north - south) / ny_o
    LON, LAT = np.meshgrid(lons, lats)
    X, Y = to_xy.transform(LON, LAT)
    col = np.rint((X - xs[0]) / dx).astype("int64")
    row = np.rint((Y - ys[0]) / dy).astype("int64")
    inside = (col >= 0) & (col < len(xs)) & (row >= 0) & (row < len(ys))
    bcol = np.where(inside, col // f, 0)
    brow = np.where(inside, row // f, 0)
    inside &= (brow < blocks.shape[0]) & (bcol < blocks.shape[1])
    out = np.where(inside, blocks[np.minimum(brow, blocks.shape[0] - 1), np.minimum(bcol, blocks.shape[1] - 1)], np.nan)
    out = np.where(np.abs(out) <= MAX_ABS_CM, out, np.nan)
    outc = None
    if cohb is not None:
        outc = np.where(inside, cohb[np.minimum(brow, blocks.shape[0] - 1), np.minimum(bcol, blocks.shape[1] - 1)], np.nan)

    q = np.where(np.isfinite(out), np.rint(out / SCALE_CM), NODATA).astype("<i2")
    wire = {
        "v": 1, "id": g["id"], "maturity": maturity, "track": g["track"], "frame": g["frame"], "direction": g["direction"],
        "reference": int(round(ref_ms)), "secondary": int(round(sec_ms)), "bbox": [west, south, east, north], "nx": int(nx_o), "ny": int(ny_o),
        "scale": SCALE_CM, "los": base64.b64encode(q.tobytes()).decode("ascii"),
    }
    if outc is not None:
        wire["coh"] = base64.b64encode(np.where(np.isfinite(outc), np.clip(np.rint(outc * 255), 0, 255), 0).astype("uint8").tobytes()).decode("ascii")
    valid_share = float(np.isfinite(out).mean())
    peak = float(np.nanmax(np.abs(out))) if np.isfinite(out).any() else 0.0
    if peak > 0 and abs(ref_level) > 0.25 * peak:
        notes.append(f"the removed reference level ({ref_level:+.1f} cm) is large compared with the signal: the window may be too small, so use a larger --radius-km")
    wire["notes"] = (
        f"LOS change in cm, positive toward the satellite, relative to the outer-ring median ({ref_level:+.2f} cm removed). "
        f"Coherence >= {min_coherence}; {valid_share:.0%} of the grid has data. No troposphere, ionosphere or solid-earth-tide correction; "
        "unwrapping errors not repaired. " + ("; ".join(notes) + "." if notes else "")
    ).strip()[:1900]
    return wire


# --------------------------------------------------------------------------- IO

def open_input(path_or_url: str, token: str | None):
    import h5py
    if re.match(r"^https?://", path_or_url):
        try:
            import fsspec
        except ImportError:
            sys.exit("Reading from a URL needs fsspec and aiohttp: pip install -r requirements.txt")
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        fs = fsspec.filesystem("https", client_kwargs={"headers": headers})
        return h5py.File(fs.open(path_or_url, "rb", block_size=8 * 1024 * 1024, cache_type="mmap"), "r")
    return h5py.File(path_or_url, "r")


def upload(base_url: str, token: str, wire: dict) -> None:
    req = urllib.request.Request(base_url.rstrip("/") + "/api/displacement/ingest", data=json.dumps(wire).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}", "User-Agent": "astrophage-nisar-grid"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            print("uploaded:", r.read().decode())
    except urllib.error.HTTPError as e:
        sys.exit(f"Upload refused ({e.code}): {e.read().decode(errors='ignore')}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="path or https URL of a NISAR GUNW .h5 file")
    ap.add_argument("--center", help="lon,lat of the event; crops to a window around it")
    ap.add_argument("--radius-km", type=float, default=100.0, help="half-width of the window (default 100)")
    ap.add_argument("--size", type=int, default=192, help="longest side of the output grid (max 256)")
    ap.add_argument("--min-coherence", type=float, default=0.3)
    ap.add_argument("--pol", default="HH")
    ap.add_argument("--maturity", default="PROVISIONAL", choices=["PROVISIONAL", "BETA", "VALIDATED"])
    ap.add_argument("--reference", help="ISO date-time of the reference acquisition (if not in the file name)")
    ap.add_argument("--secondary", help="ISO date-time of the secondary acquisition")
    ap.add_argument("--out", help="write the JSON here")
    ap.add_argument("--upload", metavar="SITE_URL", help="POST the grid to SITE_URL/api/displacement/ingest")
    ap.add_argument("--token", default=os.environ.get("INGEST_SECRET"), help="ingest secret (or env INGEST_SECRET)")
    ap.add_argument("--earthdata-token", default=os.environ.get("EARTHDATA_TOKEN"), help="NASA Earthdata bearer token for URLs (or env EARTHDATA_TOKEN)")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)

    center = tuple(float(v) for v in a.center.split(",")) if a.center else None
    if center and (len(center) != 2 or abs(center[0]) > 180 or abs(center[1]) > 90):
        sys.exit("--center must be lon,lat")
    with open_input(a.input, a.earthdata_token) as h5:
        g = read_gunw(h5, a.input, a.pol)
    wire = build_wire(g, center=center, radius_km=a.radius_km if center else None, size=a.size, min_coherence=a.min_coherence, maturity=a.maturity,
                      reference_ms=_iso_ms(a.reference), secondary_ms=_iso_ms(a.secondary))
    vals = np.frombuffer(base64.b64decode(wire["los"]), dtype="<i2")
    good = vals[vals != NODATA] * SCALE_CM
    print(f"{wire['id']}: {wire['nx']}x{wire['ny']} grid, {good.size} cells with data, LOS {good.min():+.1f} to {good.max():+.1f} cm" if good.size else "no data cells")
    if a.out:
        with open(a.out, "w") as fh:
            json.dump(wire, fh)
        print("wrote", a.out)
    if a.upload and not a.dry_run:
        if not a.token:
            sys.exit("--upload needs --token (or env INGEST_SECRET)")
        upload(a.upload, a.token, wire)
    return 0


if __name__ == "__main__":
    sys.exit(main())
