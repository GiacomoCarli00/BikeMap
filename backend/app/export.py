"""Esportazione: link Google Maps e file GPX."""
from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import quote
from xml.sax.saxutils import escape

from .geo import LatLon

# Limiti documentati da Google per i Maps URLs
MAX_WAYPOINTS_APP = 9
MAX_WAYPOINTS_MOBILE_BROWSER = 3


def _fmt(p: LatLon) -> str:
    return f"{p[0]:.6f},{p[1]:.6f}"


def google_maps_url(start: LatLon, end: LatLon, waypoints: list[LatLon], navigate: bool = False) -> str:
    url = (
        "https://www.google.com/maps/dir/?api=1"
        f"&origin={quote(_fmt(start))}"
        f"&destination={quote(_fmt(end))}"
        "&travelmode=driving"
    )
    if waypoints:
        url += "&waypoints=" + quote("|".join(_fmt(w) for w in waypoints))
    if navigate:
        url += "&dir_action=navigate"
    return url


def gpx(points: list[LatLon], name: str = "BikeMap", waypoints: list[LatLon] | None = None) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="BikeMap" xmlns="http://www.topografix.com/GPX/1/1">',
        f"  <metadata><name>{escape(name)}</name><time>{now}</time></metadata>",
    ]
    for i, w in enumerate(waypoints or [], 1):
        lines.append(f'  <wpt lat="{w[0]:.6f}" lon="{w[1]:.6f}"><name>Tappa {i}</name></wpt>')
    lines.append(f"  <trk><name>{escape(name)}</name><trkseg>")
    lines.extend(f'    <trkpt lat="{p[0]:.6f}" lon="{p[1]:.6f}"/>' for p in points)
    lines.append("  </trkseg></trk>")
    lines.append("</gpx>")
    return "\n".join(lines)
