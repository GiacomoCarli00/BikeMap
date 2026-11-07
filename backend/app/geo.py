"""Utility geometriche: distanze, ricampionamento di polilinee, indice spaziale per vicinanza.

Tutte le coordinate sono tuple (lat, lon) in gradi.
"""
from __future__ import annotations

import math
from collections import defaultdict

LatLon = tuple[float, float]
EARTH_R = 6_371_000.0


def haversine(a: LatLon, b: LatLon) -> float:
    """Distanza in metri tra due punti."""
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(h))


def polyline_length(points: list[LatLon]) -> float:
    return sum(haversine(points[i], points[i + 1]) for i in range(len(points) - 1))


def cumulative_distances(points: list[LatLon]) -> list[float]:
    out = [0.0]
    for i in range(len(points) - 1):
        out.append(out[-1] + haversine(points[i], points[i + 1]))
    return out


def resample(points: list[LatLon], step_m: float) -> list[LatLon]:
    """Punti equidistanti (circa step_m) lungo la polilinea, primo e ultimo inclusi."""
    if len(points) < 2:
        return list(points)
    out = [points[0]]
    carry = 0.0  # metri percorsi dall'ultimo campione
    for i in range(len(points) - 1):
        a, b = points[i], points[i + 1]
        seg = haversine(a, b)
        if seg == 0:
            continue
        pos = step_m - carry
        while pos <= seg:
            t = pos / seg
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
            pos += step_m
        carry = seg - (pos - step_m)
    if out[-1] != points[-1]:
        out.append(points[-1])
    return out


class _Projection:
    """Proiezione equirettangolare locale in metri, sufficiente per distanze di qualche centinaio di metri."""

    def __init__(self, ref_lat: float):
        self.kx = math.cos(math.radians(ref_lat)) * EARTH_R * math.pi / 180
        self.ky = EARTH_R * math.pi / 180

    def __call__(self, p: LatLon) -> tuple[float, float]:
        return p[1] * self.kx, p[0] * self.ky


def _point_segment_dist(px, py, ax, ay, bx, by) -> float:
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    if L2 == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


class PolylineIndex:
    """Risponde velocemente a: 'quanto dista questo punto dalla polilinea?' (fino a cell_m metri)."""

    def __init__(self, points: list[LatLon], cell_m: float = 500.0, ref_lat: float | None = None):
        if ref_lat is None:
            ref_lat = sum(p[0] for p in points) / max(len(points), 1)
        self.ref_lat = ref_lat
        self.proj = _Projection(ref_lat)
        self.cell = cell_m
        self.xy = [self.proj(p) for p in points]
        self.grid: dict[tuple[int, int], list[int]] = defaultdict(list)
        for i in range(len(self.xy) - 1):
            (ax, ay), (bx, by) = self.xy[i], self.xy[i + 1]
            # i segmenti piu' lunghi di una cella vengono registrati in tutte le celle che attraversano
            steps = max(1, int(math.hypot(bx - ax, by - ay) / cell_m) + 1)
            seen = set()
            for s in range(steps + 1):
                t = s / steps
                c = (int((ax + (bx - ax) * t) // cell_m), int((ay + (by - ay) * t) // cell_m))
                if c not in seen:
                    seen.add(c)
                    self.grid[c].append(i)

    def distance(self, p: LatLon) -> float:
        """Distanza in metri; math.inf se oltre ~cell_m."""
        px, py = self.proj(p)
        cx, cy = int(px // self.cell), int(py // self.cell)
        best = math.inf
        checked = set()
        for gx in (cx - 1, cx, cx + 1):
            for gy in (cy - 1, cy, cy + 1):
                for i in self.grid.get((gx, gy), ()):
                    if i in checked:
                        continue
                    checked.add(i)
                    (ax, ay), (bx, by) = self.xy[i], self.xy[i + 1]
                    d = _point_segment_dist(px, py, ax, ay, bx, by)
                    if d < best:
                        best = d
        return best


def nearest_index(points: list[LatLon], target: LatLon) -> int:
    return min(range(len(points)), key=lambda i: haversine(points[i], target))
