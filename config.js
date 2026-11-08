// Configurazione del frontend.
//
// BIKEMAP_ENGINE: dove si calcolano i percorsi.
//   "valhalla" -> nel browser, con il servizio pubblico Valhalla (OpenStreetMap). Nessun server tuo.
//   "backend"  -> sul server Python + GraphHopper (BIKEMAP_API_BASE).
window.BIKEMAP_ENGINE = "valhalla";

// BIKEMAP_API_BASE: usato solo con BIKEMAP_ENGINE = "backend".
//   ""                           -> stesso sito (backend locale, es. http://localhost:8000)
//   "https://tuo-server.example" -> server esterno
window.BIKEMAP_API_BASE = "";
