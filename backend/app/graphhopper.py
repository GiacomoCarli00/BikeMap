"""Client minimale per l'API /route di GraphHopper."""
from __future__ import annotations

import os
from dataclasses import dataclass, field

import httpx

from .geo import LatLon

GH_URL = os.environ.get("GRAPHHOPPER_URL", "http://localhost:8989")


class RoutingError(Exception):
    pass


@dataclass
class Route:
    points: list[LatLon]
    distance_m: float
    time_s: float
    details: dict[str, list[list]] = field(default_factory=dict)  # [from_idx, to_idx, valore]


class GraphHopper:
    def __init__(self, base_url: str = GH_URL):
        self.client = httpx.AsyncClient(base_url=base_url, timeout=60)

    async def close(self):
        await self.client.aclose()

    async def health(self) -> bool:
        try:
            r = await self.client.get("/health")
            return r.status_code == 200
        except httpx.HTTPError:
            return False

    async def route(self, points: list[LatLon], profile: str, details: list[str] | None = None) -> Route:
        body = {
            "points": [[lon, lat] for lat, lon in points],  # GraphHopper vuole [lon, lat]
            "profile": profile,
            "points_encoded": False,
            "instructions": False,
            "calc_points": True,
            "details": details or [],
        }
        if not profile.startswith("car"):
            body["ch.disable"] = True  # i profili moto usano LM, non CH
        try:
            r = await self.client.post("/route", json=body)
        except httpx.HTTPError as e:
            raise RoutingError(f"GraphHopper non raggiungibile ({GH_URL}). E' avviato?") from e
        data = r.json()
        if r.status_code != 200:
            raise RoutingError(data.get("message", f"Errore GraphHopper {r.status_code}"))
        path = data["paths"][0]
        coords = path["points"]["coordinates"]
        return Route(
            points=[(c[1], c[0]) for c in coords],
            distance_m=path["distance"],
            time_s=path["time"] / 1000,
            details=path.get("details", {}),
        )
