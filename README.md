# 🏍 BikeMap

Pianificatore di percorsi per motociclisti, open source: cerca strade curve e secondarie
e genera un **link Google Maps** con le tappe scelte in modo che Google segua (quasi) lo stesso percorso.

Tutto gira in locale: OpenStreetMap + [GraphHopper](https://github.com/graphhopper/graphhopper) + Python.

## Come funziona

1. **GraphHopper** calcola il percorso con un profilo moto (`graphhopper/custom_models/`):
   penalizza autostrade, città e sterrati e, nello stile "Curve", premia le strade tortuose.
2. Il backend **simula Google** con il profilo "auto più veloce" e aggiunge tappe dove il
   percorso simulato si allontana da quello moto, fino al limite di Google (9 tappe in app, 3 da browser mobile).
3. Il frontend mostra il percorso colorato per tortuosità, la linea tratteggiata di ciò che farà
   probabilmente Google, la percentuale di fedeltà, il link, il QR code e il GPX.

## Requisiti

- Java 17+ (per GraphHopper)
- Python 3.11+
- ~6 GB di RAM libera per l'Italia Nord-Ovest, ~12 GB per tutta Italia

## Avvio

```powershell
# 1. una volta sola: scarica GraphHopper, la mappa e le librerie Python
.\scripts\setup.ps1                 # Italia Nord-Ovest (default)
.\scripts\setup.ps1 -Region italy   # oppure tutta Italia

# 2. motore di routing (il primo avvio importa la mappa: qualche minuto)
.\scripts\start-graphhopper.ps1

# 3. in un altro terminale: backend + interfaccia
.\scripts\start-backend.ps1
```

Poi apri <http://localhost:8000>.

In VS Code: `Terminale → Esegui attività → Avvia tutto`.

## Modificare i profili moto

I file in `graphhopper/custom_models/` sono le "regole" del percorso. Dopo una modifica cancella
`data/graph-cache-<regione>` e riavvia GraphHopper.

## Struttura

```
backend/app/
  main.py          API FastAPI (/api/route, /api/geocode) e server del frontend
  graphhopper.py   client GraphHopper
  waypoints.py     algoritmo di scelta delle tappe per Google Maps
  geo.py           distanze, ricampionamento, indice spaziale
  export.py        link Google Maps e GPX
frontend/          mappa Leaflet + OpenStreetMap
graphhopper/       config.yml e profili moto
scripts/           setup e avvio
```

## Licenza

[BikeMap Human-Made License](LICENSE): chiunque può usare e modificare BikeMap, ma **le modifiche
vanno scritte a mano, senza intelligenza artificiale**. La prima versione è stata fatta con Claude;
da qui in avanti l'unico modo di renderlo migliore, moralmente e umanamente, è farlo "a mano".

Mappa © contributori OpenStreetMap (ODbL). Ricerca luoghi via Nominatim (max 1 richiesta/secondo).
