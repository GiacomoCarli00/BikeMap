"""Scelta delle tappe per il link Google Maps.

Idea: Google tra una tappa e l'altra sceglie la strada piu' veloce. Lo simuliamo con il profilo
"auto" di GraphHopper e aggiungiamo tappe dove il percorso simulato si allontana dal percorso moto,
finche' i due coincidono o finiscono le tappe disponibili.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable

from .geo import LatLon, PolylineIndex, nearest_index, resample

SAMPLE_STEP_M = 100.0   # densita' dei punti di controllo lungo il percorso
TOLERANCE_M = 120.0     # entro questa distanza consideriamo "stessa strada"
TARGET_FIDELITY = 0.97

CarRouter = Callable[[list[LatLon]], Awaitable[list[LatLon]]]


@dataclass
class WaypointResult:
    waypoints: list[LatLon]
    simulated: list[LatLon]   # percorso che probabilmente fara' Google
    fidelity: float           # 0..1, quanto il percorso simulato coincide con quello moto
    iterations: int


def _coverage(samples: list[LatLon], other: PolylineIndex) -> list[bool]:
    return [other.distance(s) <= TOLERANCE_M for s in samples]


def _fidelity(moto_samples: list[LatLon], moto_index: PolylineIndex, car: list[LatLon]) -> tuple[float, list[bool]]:
    car_index = PolylineIndex(car, ref_lat=moto_index.ref_lat)
    on_moto = _coverage(moto_samples, car_index)
    # Anche al contrario: Google non deve fare deviazioni che il percorso moto non prevede
    car_samples = resample(car, SAMPLE_STEP_M)
    on_car = _coverage(car_samples, moto_index)
    f = min(sum(on_moto) / len(on_moto), sum(on_car) / len(on_car))
    return f, on_moto


def _longest_off_run(on: list[bool], locked: set[int]) -> int | None:
    """Indice centrale del tratto piu' lungo in cui il percorso simulato non segue quello moto."""
    best_len, best_mid = 0, None
    i = 0
    while i < len(on):
        if on[i]:
            i += 1
            continue
        j = i
        while j < len(on) and not on[j]:
            j += 1
        mid = (i + j - 1) // 2
        if j - i > best_len and mid not in locked:
            best_len, best_mid = j - i, mid
        i = j
    return best_mid


async def choose_waypoints(
    moto_route: list[LatLon],
    car_router: CarRouter,
    max_waypoints: int = 9,
    fixed: list[LatLon] | None = None,
) -> WaypointResult:
    samples = resample(moto_route, SAMPLE_STEP_M)
    moto_index = PolylineIndex(moto_route)
    start, end = moto_route[0], moto_route[-1]

    # Le tappe scelte dall'utente sono obbligatorie
    chosen: set[int] = {nearest_index(samples, p) for p in (fixed or [])}
    chosen.discard(0)
    chosen.discard(len(samples) - 1)
    locked = set(chosen)

    async def evaluate(idx: set[int]):
        pts = [start] + [samples[i] for i in sorted(idx)] + [end]
        car = await car_router(pts)
        f, on = _fidelity(samples, moto_index, car)
        return car, f, on

    car, fid, on = await evaluate(chosen)
    iterations = 1
    while fid < TARGET_FIDELITY and len(chosen) < max_waypoints:
        cand = _longest_off_run(on, chosen)
        if cand is None or cand in (0, len(samples) - 1):
            break
        trial = chosen | {cand}
        t_car, t_fid, t_on = await evaluate(trial)
        iterations += 1
        chosen, car, fid, on = trial, t_car, t_fid, t_on

    # Pulizia: togliamo le tappe diventate inutili (meno tappe = link piu' robusto)
    for i in sorted(chosen - locked):
        trial = chosen - {i}
        t_car, t_fid, t_on = await evaluate(trial)
        iterations += 1
        if t_fid >= fid - 0.003:
            chosen, car, fid, on = trial, t_car, t_fid, t_on

    return WaypointResult(
        waypoints=[samples[i] for i in sorted(chosen)],
        simulated=car,
        fidelity=fid,
        iterations=iterations,
    )
