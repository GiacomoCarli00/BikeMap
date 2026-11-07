"""BikeMap: API e server del frontend.

Avvio:  uvicorn app.main:app --reload   (dalla cartella backend)
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .export import MAX_WAYPOINTS_APP, gpx, google_maps_url
from .geo import cumulative_distances
from .graphhopper import GraphHopper, RoutingError
from .waypoints import choose_waypoints

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "BikeMap/0.1 (open source motorcycle route planner, personal use)"

gh = GraphHopper()


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await gh.close()


app = FastAPI(title="BikeMap", lifespan=lifespan)


class RouteRequest(BaseModel):
    start: tuple[float, float]                      # (lat, lon)
    end: tuple[float, float]
    via: list[tuple[float, float]] = []             # tappe scelte dall'utente
    style: Literal["moto", "moto_curve"] = "moto_curve"
    max_waypoints: int = Field(default=MAX_WAYPOINTS_APP, ge=0, le=MAX_WAYPOINTS_APP)
    google_avoid_highways: bool = False             # l'utente attivera' "Evita autostrade" in Google Maps?


def _curvy_share(points, curvature_details) -> dict:
    """Percentuale di km per fascia di tortuosita'."""
    cum = cumulative_distances(points)
    total = cum[-1] or 1
    buckets = {"molto_curvo": 0.0, "curvo": 0.0, "mosso": 0.0, "dritto": 0.0}
    for a, b, v in curvature_details:
        d = cum[b] - cum[a]
        if v < 0.8:
            buckets["molto_curvo"] += d
        elif v < 0.9:
            buckets["curvo"] += d
        elif v < 0.98:
            buckets["mosso"] += d
        else:
            buckets["dritto"] += d
    return {k: round(v / total, 3) for k, v in buckets.items()}


@app.get("/api/health")
async def health():
    return {"graphhopper": await gh.health()}


@app.post("/api/route")
async def route(req: RouteRequest):
    car_profile = "car_no_motorway" if req.google_avoid_highways else "car"
    try:
        moto = await gh.route([req.start, *req.via, req.end], req.style, details=["curvature", "road_class"])
        fastest = await gh.route([req.start, req.end], car_profile)

        async def car_router(pts):
            return (await gh.route(pts, car_profile)).points

        wp = await choose_waypoints(moto.points, car_router, req.max_waypoints, fixed=req.via)
    except RoutingError as e:
        raise HTTPException(status_code=502, detail=str(e))

    start, end = moto.points[0], moto.points[-1]
    return {
        "route": {
            "points": moto.points,
            "distance_m": moto.distance_m,
            "time_s": moto.time_s,
            "curvature": moto.details.get("curvature", []),
            "curvy_share": _curvy_share(moto.points, moto.details.get("curvature", [])),
        },
        "fastest": {"distance_m": fastest.distance_m, "time_s": fastest.time_s},
        "google": {
            "url": google_maps_url(req.start, req.end, wp.waypoints),
            "waypoints": wp.waypoints,
            "simulated": wp.simulated,
            "fidelity": round(wp.fidelity, 3),
            "iterations": wp.iterations,
        },
        "gpx": gpx(moto.points, "BikeMap", wp.waypoints),
        "snapped": {"start": start, "end": end},
    }


@app.get("/api/geocode")
async def geocode(q: str = Query(min_length=2)):
    """Cerca un luogo per nome (Nominatim / OpenStreetMap)."""
    async with httpx.AsyncClient(timeout=10, headers={"User-Agent": USER_AGENT}) as c:
        r = await c.get(NOMINATIM, params={"q": q, "format": "jsonv2", "limit": 6, "countrycodes": "it"})
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="Ricerca luoghi non disponibile")
    return [
        {"name": x["display_name"], "lat": float(x["lat"]), "lon": float(x["lon"])}
        for x in r.json()
    ]


@app.get("/")
async def index():
    return FileResponse(FRONTEND / "index.html")


app.mount("/static", StaticFiles(directory=FRONTEND), name="static")
