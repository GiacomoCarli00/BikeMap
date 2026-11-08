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

// Stime dei costi (valori indicativi: aggiornali quando vuoi).
window.BIKEMAP_COSTS = {
  // benzina self, prezzo medio rete stradale, al litro. Fonte: osservatori dei carburanti (MIMIT),
  // dato di settembre 2026: https://www.mimit.gov.it (Osservaprezzi carburanti) per il valore attuale.
  fuelPricePerL: 2.132,
  fuelPriceDate: "2026-09-16",
  // km per litro per ciascun tipo di percorso
  kmPerL: { sport: 10, tour: 18, crossover: 15 },
  // pedaggio stimato per km a pedaggio (tariffa classe A, che include le moto; stima, non tariffa ufficiale)
  tollEurPerKm: 0.08,
};
