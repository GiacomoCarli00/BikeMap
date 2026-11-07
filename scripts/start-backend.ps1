# Avvia il backend + frontend su http://localhost:8000
$root = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $root "backend")
try {
    & (Join-Path $root ".venv\Scripts\python.exe") -m uvicorn app.main:app --reload --port 8000
} finally { Pop-Location }
