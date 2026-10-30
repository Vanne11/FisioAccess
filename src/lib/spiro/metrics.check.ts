// Self-check: `npx tsx src/lib/spiro/metrics.check.ts`
import { closeInspLimb, computeSpiroMetrics, reportedValues, type SpiroMetrics } from "./metrics";
import { computeQuality } from "./quality";
import type { SpiroPoint } from "@/components/shared/SpiroCharts";

function assert(cond: boolean, msg = "check failed") {
  if (!cond) throw new Error(msg);
}

// Lazo abierto: espira 4 L a 1 L/s, inspira solo 3 L.
const curve: SpiroPoint[] = [];
for (let i = 0; i <= 40; i++) curve.push({ t: i * 0.1, p: 0, f: 1, v: i * 0.1 });
for (let i = 1; i <= 30; i++) curve.push({ t: 4 + i * 0.1, p: 0, f: -1, v: 4 - i * 0.1 });

const closed = closeInspLimb(curve, 0);
assert(Math.abs(closed[closed.length - 1].v) < 1e-9, "el lazo termina en V=0");
assert(closed[40].v === 4, "rama espiratoria intacta");

const m = computeSpiroMetrics(curve, 1, 2)!;
assert(Math.abs(m.fvc! - 4) < 1e-9);
assert(Math.abs(m.fef2575! - 1) < 1e-9, "flujo constante 1 L/s → FEF25-75 = 1");
// Valores informados: mejor FVC y mejor FEV1 de maniobras distintas,
// flujos de la de mayor FEV1+FVC; la que falla BEV se ignora.
const mk = (fvc: number, fev1: number, pef: number, bev: number) =>
  ({ ...m, fvc, fev1, pef, backExtrap: { t0: 0, v0: bev, bev } }) as SpiroMetrics;
const r = reportedValues([
  { number: 1, m: mk(4.0, 3.0, 5, 0) },
  { number: 2, m: mk(3.8, 3.3, 6, 0) },
  { number: 3, m: mk(5.0, 4.0, 9, 0.5) }, // BEV 500 mL → no aceptable
])!;
assert(r.fvc === 4.0 && r.fev1 === 3.3, "best FVC / best FEV1 por separado");
assert(r.bestTestNumber === 2 && r.pef === 6, "flujos de la mejor prueba (FEV1+FVC)");
assert(r.nAccepted === 2 && !r.fallback);

// FEV1 incluye el BEV: arranque lento (rampa) → t0_be > 0 y BEV > 0,
// pero FEV1 = V(t0 + 1 s) medido desde V = 0, sin restar el BEV.
const ramp: SpiroPoint[] = [];
let vol = 0;
for (let i = 0; i <= 300; i++) {
  const t = i * 0.02;
  const f = t < 0.3 ? 20 * t * t : 6 * Math.exp(-(t - 0.3) / 0.6);
  vol += f * 0.02;
  ramp.push({ t, p: 0, f, v: vol });
}
const mr = computeSpiroMetrics(ramp, 1, 2)!;
assert(mr.backExtrap!.bev > 0, "la rampa produce BEV");
const vAt = ramp.find((p) => p.t >= mr.backExtrap!.t0 + 1 - 1e-9)!.v;
assert(Math.abs(mr.fev1! - vAt) < 0.02, "FEV1 = V(t0+1) sin restar BEV");
assert(Math.abs(mr.fvc! - vol) < 1e-9, "FVC = volumen total exhalado");

// Grado ATS/ERS 2019 por repetibilidad de FEV1/FVC.
const q = computeQuality([mk(4.0, 3.0, 5, 0), mk(3.9, 2.9, 5, 0), mk(3.8, 2.85, 5, 0)]);
assert(q.grade === "A" && q.fev1RepMl! < 101, "3 aceptables a ≤150 mL → A");
assert(computeQuality([mk(4.0, 3.0, 5, 0), mk(3.7, 3.0, 5, 0)]).grade === "E", "ΔFVC 300 mL → E");
assert(computeQuality([mk(4.0, 3.0, 5, 0.5)]).grade === "F", "ninguna aceptable → F");

console.log("ok");
