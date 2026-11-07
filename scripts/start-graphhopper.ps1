# Avvia GraphHopper su http://localhost:8989
# Al primo avvio importa la mappa e prepara il grafo (alcuni minuti), poi parte in pochi secondi.
# Se modifichi config.yml o i custom model, cancella la cartella data\graph-cache-<regione> per reimportare.
param([string]$Region = "")

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$ghDir = Join-Path $root "graphhopper"
if (-not $Region) { $Region = (Get-Content (Join-Path $root "data\region.txt")).Trim() }

$jar = Get-ChildItem $ghDir -Filter "graphhopper-web-*.jar" | Select-Object -First 1
if (-not $jar) { throw "GraphHopper non trovato: esegui prima scripts\setup.ps1" }
$pbf = Join-Path $root "data\$Region-latest.osm.pbf"
$cache = Join-Path $root "data\graph-cache-$Region"

Push-Location $ghDir
try {
    java -Xmx12g -Xms2g `
        "-Ddw.graphhopper.datareader.file=$pbf" `
        "-Ddw.graphhopper.graph.location=$cache" `
        -jar $jar.FullName server config.yml
} finally { Pop-Location }
