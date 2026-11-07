# Scarica GraphHopper e i dati OpenStreetMap, e prepara l'ambiente Python.
# Uso:  .\scripts\setup.ps1                  (Italia Nord-Ovest, ~600 MB)
#       .\scripts\setup.ps1 -Region italy    (tutta Italia, ~2.3 GB)
#       Regioni disponibili: nord-ovest, nord-est, centro, sud, isole, italy
param(
    [string]$Region = "nord-ovest",
    [string]$GhVersion = "11.1"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # rende Invoke-WebRequest molto piu' veloce
$root = Split-Path -Parent $PSScriptRoot

# --- GraphHopper ---
$ghDir = Join-Path $root "graphhopper"
New-Item -ItemType Directory -Force $ghDir | Out-Null
$jar = Join-Path $ghDir "graphhopper-web-$GhVersion.jar"
if (-not (Test-Path $jar)) {
    Write-Host "Scarico GraphHopper $GhVersion..."
    Invoke-WebRequest -UseBasicParsing `
        "https://repo1.maven.org/maven2/com/graphhopper/graphhopper-web/$GhVersion/graphhopper-web-$GhVersion.jar" `
        -OutFile $jar
} else { Write-Host "GraphHopper gia' presente." }

# --- Dati OSM (Geofabrik) ---
$dataDir = Join-Path $root "data"
New-Item -ItemType Directory -Force $dataDir | Out-Null
if ($Region -eq "italy") {
    $url = "https://download.geofabrik.de/europe/italy-latest.osm.pbf"
} else {
    $url = "https://download.geofabrik.de/europe/italy/$Region-latest.osm.pbf"
}
$pbf = Join-Path $dataDir "$Region-latest.osm.pbf"
if (-not (Test-Path $pbf)) {
    Write-Host "Scarico la mappa ($Region) da Geofabrik, puo' richiedere qualche minuto..."
    Invoke-WebRequest -UseBasicParsing $url -OutFile "$pbf.part"
    Move-Item "$pbf.part" $pbf
} else { Write-Host "Mappa $Region gia' presente." }
Set-Content -Path (Join-Path $dataDir "region.txt") -Value $Region -Encoding ascii

# --- Python venv ---
$venv = Join-Path $root ".venv"
if (-not (Test-Path $venv)) {
    Write-Host "Creo l'ambiente Python..."
    python -m venv $venv
}
& (Join-Path $venv "Scripts\python.exe") -m pip install --quiet --upgrade pip
& (Join-Path $venv "Scripts\python.exe") -m pip install --quiet -r (Join-Path $root "backend\requirements.txt")

Write-Host "Setup completato."
