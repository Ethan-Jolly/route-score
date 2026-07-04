// Drives the fill endpoint to warm the homepage example routes.
const BASE = process.env.BASE ?? "http://localhost:3000";
const ROUTES = [
  { from: "RDG", to: "PAD", band: "am-peak" },
  { from: "MAN", to: "LDS", band: "pm-peak" },
  { from: "CBG", to: "KGX", band: "am-peak" },
  { from: "GLC", to: "EDB", band: "all-day" },
  { from: "WOK", to: "WAT", band: "am-peak" },
];

for (const r of ROUTES) {
  for (let i = 0; i < 6; i++) {
    const res = await fetch(`${BASE}/api/route-score/fill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(r),
    });
    if (!res.ok) {
      console.log(`${r.from}-${r.to}-${r.band}: HTTP ${res.status}`);
      break;
    }
    const p = await res.json();
    console.log(
      `${r.from}-${r.to}-${r.band}: ${p.cached}/${p.total}${p.done ? " DONE" : ""}`
    );
    if (p.done) break;
  }
}
console.log("warm-examples finished");
