import asyncio
from urllib.parse import parse_qs, urlparse

from app.export import google_maps_url, gpx
from app.geo import PolylineIndex, haversine, polyline_length, resample
from app.waypoints import choose_waypoints


def test_haversine_one_degree_lat():
    assert abs(haversine((45, 9), (46, 9)) - 111_195) < 50


def test_resample_spacing():
    line = [(45.0, 9.0), (45.0, 9.1)]  # ~7.9 km
    pts = resample(line, 100)
    assert pts[0] == line[0] and pts[-1] == line[-1]
    assert abs(len(pts) - polyline_length(line) / 100) < 3


def test_polyline_index_distance():
    idx = PolylineIndex([(45.0, 9.0), (45.0, 9.1)])
    assert idx.distance((45.0, 9.05)) < 1
    assert abs(idx.distance((45.001, 9.05)) - 111) < 2
    assert idx.distance((45.1, 9.05)) == float("inf")


def test_google_url():
    url = google_maps_url((45.1, 9.2), (46.3, 10.4), [(45.5, 9.5), (45.9, 9.9)])
    q = parse_qs(urlparse(url).query)
    assert q["api"] == ["1"]
    assert q["origin"] == ["45.100000,9.200000"]
    assert q["waypoints"] == ["45.500000,9.500000|45.900000,9.900000"]
    assert q["travelmode"] == ["driving"]


def test_gpx_has_track():
    out = gpx([(45, 9), (45.1, 9.1)], waypoints=[(45.05, 9.05)])
    assert out.count("<trkpt") == 2 and out.count("<wpt") == 1


def test_choose_waypoints_pulls_car_onto_detour():
    """Moto: va da A a B passando per una 'montagna' a nord. Auto: va dritta, a meno che
    non le si dia una tappa sulla montagna."""
    A, B, M = (45.0, 9.0), (45.0, 9.2), (45.1, 9.1)
    moto = [A, M, B]

    async def car_router(pts):
        # l'auto passa per le tappe con linee dritte (come un vero router su strade dritte)
        return pts

    res = asyncio.run(choose_waypoints(moto, car_router, max_waypoints=9))
    assert res.fidelity >= 0.97
    assert 1 <= len(res.waypoints) <= 3
    # la tappa deve stare vicino alla 'montagna'
    assert min(haversine(w, M) for w in res.waypoints) < 3000
