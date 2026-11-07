"""Tests on synthetic files that follow the GUNW layout documented for NISAR. They prove the maths and the plumbing,
not that a real product matches the layout: confirm that with the first real file (see docs/DISPLACEMENT.md)."""
import base64
import json
import math
import os
import sys

import h5py
import numpy as np
import pytest
from pyproj import Transformer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import nisar_grid as ng  # noqa: E402

NAME = "NISAR_L2_PR_GUNW_004_005_A_018_4005_DHDH_A_20260801T000000_20260801T000030_20260813T000000_20260813T000030_X_001.h5"
EPSG = 32645  # UTM 45N covers 84-90 E
EVENT = (86.5, 28.0)
LAM = ng.DEFAULT_WAVELENGTH_M


def make_gunw(path, bump_cm=30.0, sigma_km=15.0, n=1500, offset_xy=(0.0, 0.0), low_coh_box=None, mask_value=11, epsg_as_attr=True):
    """80 m UTM grid, 120 km square centred on EVENT, with a Gaussian LOS-toward-satellite bump (plus a constant 4 cm offset)."""
    cx, cy = Transformer.from_crs(4326, EPSG, always_xy=True).transform(*EVENT)
    x = cx - n * 80 / 2 + 80 * (np.arange(n) + 0.5)
    y = (cy + n * 80 / 2) - 80 * (np.arange(n) + 0.5)  # north-up: y decreases
    X, Y = np.meshgrid(x, y)
    r2 = ((X - cx - offset_xy[0]) ** 2 + (Y - cy - offset_xy[1]) ** 2) / (sigma_km * 1000) ** 2
    toward_cm = bump_cm * np.exp(-r2) + 4.0
    phase = (-toward_cm / 100.0 * 4 * math.pi / LAM).astype("float32")  # inverse of phase_to_los_cm
    coh = np.full((n, n), 0.9, dtype="float32")
    if low_coh_box:
        r0, r1, c0, c1 = low_coh_box
        coh[r0:r1, c0:c1] = 0.1
    with h5py.File(path, "w") as h:
        g = h.create_group(ng.BASE)
        g.create_dataset("HH/unwrappedPhase", data=phase)
        g.create_dataset("HH/coherenceMagnitude", data=coh)
        g.create_dataset("mask", data=np.full((n, n), mask_value, dtype="uint8"))
        g.create_dataset("xCoordinates", data=x)
        g.create_dataset("yCoordinates", data=y)
        p = g.create_dataset("projection", data=np.int32(EPSG))
        if epsg_as_attr:
            p.attrs["epsg_code"] = EPSG
    return path


def sample(w, lon, lat):
    west, south, east, north = w["bbox"]
    i = min(w["nx"] - 1, int((lon - west) / (east - west) * w["nx"]))
    j = min(w["ny"] - 1, int((north - lat) / (north - south) * w["ny"]))
    v = np.frombuffer(base64.b64decode(w["los"]), dtype="<i2")[j * w["nx"] + i]
    return None if v == ng.NODATA else v * ng.SCALE_CM


def process(path, **kw):
    with h5py.File(path, "r") as h:
        g = ng.read_gunw(h, NAME)
    return ng.build_wire(g, center=EVENT, radius_km=100, **kw)


def test_sign_convention_positive_toward_satellite():
    # Negative phase = shorter path = ground moved toward the satellite = positive value.
    assert ng.phase_to_los_cm(np.array([-2 * math.pi], dtype="float32"))[0] == pytest.approx(LAM / 2 * 100, rel=1e-4)
    assert ng.phase_to_los_cm(np.array([2 * math.pi], dtype="float32"))[0] == pytest.approx(-LAM / 2 * 100, rel=1e-4)


def test_mask_digits():
    m = np.array([11, 22, 255, 111, 10, 1, 0], dtype="uint8")
    assert ng.mask_ok(m).tolist() == [True, True, False, False, False, False, False]


def test_block_mean_ignores_invalid_pixels_and_needs_half_coverage():
    a = np.arange(16, dtype="float32").reshape(4, 4)
    valid = np.ones((4, 4), bool); valid[0, 0] = False
    out = ng.block_mean(a, valid, 2)
    assert out[0, 0] == pytest.approx((1 + 4 + 5) / 3)
    valid[2:, 2:] = False; valid[2, 2] = True
    assert np.isnan(ng.block_mean(a, valid, 2)[1, 1])


def test_reference_level_uses_outer_ring():
    g = np.full((40, 40), 5.0, dtype="float32"); g[15:25, 15:25] = 35.0
    out, ref = ng.remove_reference_level(g)
    assert ref == pytest.approx(5.0)
    assert out[20, 20] == pytest.approx(30.0) and out[0, 0] == pytest.approx(0.0)


def test_end_to_end_recovers_the_bump(tmp_path):
    w = process(make_gunw(tmp_path / NAME))
    assert w["v"] == 1 and w["maturity"] == "PROVISIONAL" and (w["track"], w["frame"], w["direction"]) == (5, 18, "A")
    assert w["nx"] <= 256 and w["ny"] <= 256
    west, south, east, north = w["bbox"]
    assert west < EVENT[0] < east and south < EVENT[1] < north
    assert sample(w, *EVENT) == pytest.approx(30.0, abs=2.0)       # the 4 cm offset is removed, the 30 cm bump stays
    assert abs(sample(w, west + 0.05, south + 0.05)) < 1.5        # far field ~ 0
    assert w["reference"] < w["secondary"]
    assert "No troposphere" in w["notes"] and "toward the satellite" in w["notes"]


def test_bump_lands_in_the_right_place(tmp_path):
    # Bump 30 km north and 20 km east of the centre.
    w = process(make_gunw(tmp_path / NAME, offset_xy=(20_000, 30_000), sigma_km=8.0))
    vals = np.frombuffer(base64.b64decode(w["los"]), dtype="<i2").reshape(w["ny"], w["nx"]).astype(float)
    vals[vals == ng.NODATA] = np.nan
    j, i = np.unravel_index(np.nanargmax(vals), vals.shape)
    west, south, east, north = w["bbox"]
    lon = west + (i + 0.5) / w["nx"] * (east - west)
    lat = north - (j + 0.5) / w["ny"] * (north - south)
    exp_lon, exp_lat = Transformer.from_crs(EPSG, 4326, always_xy=True).transform(*(np.array(Transformer.from_crs(4326, EPSG, always_xy=True).transform(*EVENT)) + [20_000, 30_000]))
    assert lon == pytest.approx(exp_lon, abs=0.05) and lat == pytest.approx(exp_lat, abs=0.05)
    assert lat > EVENT[1] and lon > EVENT[0]


def test_low_coherence_becomes_no_data(tmp_path):
    w = process(make_gunw(tmp_path / NAME, low_coh_box=(0, 1500, 0, 600)))  # western 40 % unusable
    west, south, east, north = w["bbox"]
    assert sample(w, west + 0.02, (south + north) / 2) is None
    assert sample(w, *EVENT) == pytest.approx(30.0, abs=2.5)
    assert "of the grid has data" in w["notes"]


def test_product_mask_ignored_when_it_would_remove_everything(tmp_path):
    w = process(make_gunw(tmp_path / NAME, mask_value=0))  # every pixel "invalid subswath" -> we assume the layout is wrong
    assert "product mask ignored" in w["notes"]
    assert sample(w, *EVENT) == pytest.approx(30.0, abs=2.0)


def test_epsg_read_from_value_when_attribute_missing(tmp_path):
    w = process(make_gunw(tmp_path / NAME, epsg_as_attr=False))
    assert sample(w, *EVENT) == pytest.approx(30.0, abs=2.0)


def test_warns_when_the_window_is_too_small_for_the_signal(tmp_path):
    p = make_gunw(tmp_path / NAME)
    with h5py.File(p, "r") as h:
        g = ng.read_gunw(h, NAME)
    small = ng.build_wire(g, center=EVENT, radius_km=20)   # the outer ring still sits inside the 15 km-sigma bump
    assert "window may be too small" in small["notes"]
    large = ng.build_wire(g, center=EVENT, radius_km=55)
    assert "window may be too small" not in large["notes"]


def test_dates_come_from_the_name_or_arguments(tmp_path):
    p = make_gunw(tmp_path / "plain_name.h5", n=400)
    with h5py.File(p, "r") as h:
        g = ng.read_gunw(h, "plain_name.h5")
    assert g["reference"] is None
    with pytest.raises(ValueError, match="--reference"):
        ng.build_wire(g, center=EVENT, radius_km=20)
    ref, sec = ng._iso_ms("2026-08-01T00:00:00Z"), ng._iso_ms("2026-08-13T00:00:00Z")
    w = ng.build_wire(g, center=EVENT, radius_km=20, reference_ms=sec, secondary_ms=ref)  # swapped on purpose
    assert (w["reference"], w["secondary"]) == (int(ref), int(sec))


def test_event_outside_the_frame_is_an_error(tmp_path):
    p = make_gunw(tmp_path / NAME, n=300)
    with h5py.File(p, "r") as h:
        g = ng.read_gunw(h, NAME)
    with pytest.raises(ValueError, match="outside"):
        ng.build_wire(g, center=(80.0, 10.0), radius_km=50)


def test_missing_group_gives_a_clear_error(tmp_path):
    p = tmp_path / "empty.h5"
    with h5py.File(p, "w") as h:
        h.create_group("science")
    with h5py.File(p, "r") as h, pytest.raises(KeyError, match="unwrappedPhase"):
        ng.read_gunw(h, NAME)


def test_cli_writes_json_the_app_accepts(tmp_path, capsys):
    p = make_gunw(tmp_path / NAME, n=1500)
    out = tmp_path / "grid.json"
    assert ng.main([str(p), "--center", "86.5,28.0", "--radius-km", "55", "--size", "64", "--out", str(out), "--dry-run"]) == 0
    w = json.loads(out.read_text())
    assert w["nx"] <= 64 and w["ny"] <= 64 and w["scale"] == 0.1
    assert len(w["los"]) == math.ceil(w["nx"] * w["ny"] * 2 / 3) * 4  # what validateWire in the app checks
    if os.environ.get("WRITE_FIXTURE"):
        fx = os.path.join(os.path.dirname(__file__), "..", "..", "..", "src", "lib", "__tests__", "fixtures", "gunw-grid.json")
        os.makedirs(os.path.dirname(fx), exist_ok=True)
        json.dump(w, open(fx, "w"))
