import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import auto_ingest as ai  # noqa: E402

T = lambda s: datetime.strptime(s, "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc).timestamp() * 1000


def gunw(ref, sec, frame=18):
    r, s = ref, sec
    return f"NISAR_L2_PR_GUNW_004_005_A_{frame:03d}_4005_DHDH_A_{r}T000000_{r}T000030_{s}T000000_{s}T000030_X05009_N_F_J_001.h5"


def feat(name):
    return {"properties": {"fileName": name, "url": "https://datapool.example/" + name, "bytes": 1}}


EVENT = {"id": "us1", "title": "Test quake", "lon": 86.5, "lat": 28.0, "time": T("20261010T120000"), "mag": 7.0}


def test_pair_dates_come_from_the_file_name():
    ref, sec = ai.pair_of(gunw("20261001", "20261013"))
    assert ref == T("20261001T000000") and sec == T("20261013T000000")
    assert ai.pair_of("NISAR_no_dates.h5") is None


def test_candidates_drop_non_gunw_and_duplicates():
    data = {"features": [feat(gunw("20261001", "20261013")), feat(gunw("20261001", "20261013")), feat("NISAR_L2_PR_GCOV_x.h5"),
                         {"properties": {"fileName": gunw("20260901", "20260913")}}]}  # no url
    c = ai.candidates(data)
    assert len(c) == 1 and c[0]["url"].startswith("https://")


def test_pick_pair_needs_to_span_and_prefers_the_shortest():
    data = {"features": [feat(gunw("20261001", "20261013")), feat(gunw("20260925", "20261025")), feat(gunw("20261011", "20261023")),
                         feat(gunw("20260901", "20261005"))]}
    got = ai.pick_pair(ai.candidates(data), EVENT["time"])
    assert got["ref"] == T("20261001T000000")  # 12 days, spans; the 30-day one is longer; the others do not span
    assert ai.pick_pair(ai.candidates({"features": [feat(gunw("20261011", "20261023"))]}), EVENT["time"]) is None


def test_events_are_parsed_biggest_first_and_junk_is_skipped():
    d = {"features": [
        {"id": "a", "geometry": {"coordinates": [1, 2, 10]}, "properties": {"mag": 6.1, "time": 5, "place": "A"}},
        {"id": "b", "geometry": {"coordinates": [3, 4, 10]}, "properties": {"mag": 7.2, "time": 6, "place": "B"}},
        {"id": "c", "geometry": {"coordinates": [3, 4, 10]}, "properties": {"mag": None, "time": 6}},
        {"id": "d"}]}
    assert [e["id"] for e in ai.parse_events(d)] == ["b", "a"]
    assert ai.parse_events(None) == [] and ai.parse_events({"features": "x"}) == []


def test_window_radius_scales_with_magnitude_within_limits():
    assert ai.window_radius_km(5.5) == 100 and ai.window_radius_km(7.0) == 125 and ai.window_radius_km(9.5) == 250


def test_urls_are_well_formed():
    u = ai.asf_url(86.5, 28.0, T("20260701T000000"), T("20261101T000000"))
    assert "dataset=NISAR" in u and "processingLevel=GUNW" in u and "POINT%2886.5000+28.0000%29" in u and "output=geojson" in u
    assert "minmagnitude=6" in ai.usgs_url(6.0, 30, T("20261101T000000"))


def make_fetch(have_grid=False, features=None, configured=True):
    calls = []

    def fetch(url):
        calls.append(url)
        if "earthquake.usgs.gov" in url:
            return {"features": [{"id": "us1", "geometry": {"coordinates": [86.5, 28.0, 10]}, "properties": {"mag": 7.0, "time": EVENT["time"], "place": "Test quake"}}]}
        if "api.daac.asf" in url:
            return {"features": features if features is not None else [feat(gunw("20261001", "20261013"))]}
        if "/api/displacement" in url:
            if "lat=0&lon=0" in url:
                return {"configured": configured, "fields": []}
            return {"configured": True, "fields": [{"id": "x"}] if have_grid else []}
        raise AssertionError(url)
    fetch.calls = calls
    return fetch


def run(fetch, **kw):
    logs, seen = [], []
    def proc(ev, pair, **k):
        seen.append(pair["name"]); return "ok"
    args = dict(site="https://s", min_mag=6, days=30, max_new=2, maturity="PROVISIONAL", dry=False, now_ms=T("20261101T000000"), fetch=fetch, process=proc, log=logs.append)
    args.update(kw)
    return ai.run(**args), seen, logs


def test_processes_an_event_that_has_a_spanning_pair():
    stats, seen, _ = run(make_fetch())
    assert stats["done"] == 1 and len(seen) == 1


def test_skips_events_that_already_have_a_grid_without_searching_asf():
    f = make_fetch(have_grid=True)
    stats, seen, _ = run(f)
    assert stats["have"] == 1 and not seen and not any("api.daac.asf" in u for u in f.calls)


def test_no_spanning_pair_is_quiet_not_a_failure():
    stats, seen, _ = run(make_fetch(features=[feat(gunw("20261011", "20261023"))]))
    assert stats["no_pair"] == 1 and stats["failed"] == 0 and not seen


def test_a_bad_file_is_logged_and_the_run_continues():
    def boom(ev, pair, **k):
        raise SystemExit("Upload refused (401)")
    stats, _, logs = run(make_fetch(), process=boom)
    assert stats["failed"] == 1 and any("FAILED" in l and "401" in l for l in logs)


def test_a_site_without_a_database_stops_early():
    stats, seen, logs = run(make_fetch(configured=False))
    assert stats["failed"] == 1 and not seen and any("no database" in l for l in logs)


def test_new_file_limit_per_run():
    stats, seen, logs = run(make_fetch(), max_new=0)
    assert not seen and any("limit of 0" in l for l in logs)


def test_process_event_end_to_end_on_a_local_file(tmp_path, monkeypatch):
    """The glue between the search result and the processor: read, crop around the event, upload."""
    from test_nisar_grid import EVENT as EV, NAME, make_gunw
    path = make_gunw(tmp_path / NAME)
    sent = []
    monkeypatch.setattr(ai.ng, "upload", lambda site, token, wire: sent.append((site, token, wire)))
    ev = {"lon": EV[0], "lat": EV[1], "mag": 7.0, "title": "t", "time": T("20261010T120000")}
    pair = {"name": NAME, "url": str(path), "ref": T("20261001T000000"), "sec": T("20261013T000000")}
    msg = ai.process_event(ev, pair, site="https://s", ingest="secret", earthdata=None, maturity="PROVISIONAL", dry=False)
    assert msg.startswith("uploaded") and sent[0][0] == "https://s" and sent[0][1] == "secret"
    w = sent[0][2]
    assert w["reference"] == pair["ref"] and w["secondary"] == pair["sec"]
    dry = ai.process_event(ev, pair, site=None, ingest=None, earthdata=None, maturity="PROVISIONAL", dry=True)
    assert dry.startswith("dry run") and len(sent) == 1
