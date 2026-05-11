import type { SpiroPoint } from "@/components/shared/SpiroCharts";

export interface SpiroMetrics {
  pef: number | null;
  fvc: number | null;
  fevA: number | null;
  fevB: number | null;
  deltaV: number | null;
  fef25: number | null;
  fef50: number | null;
  fef75: number | null;
  fevAOverFvc: number | null;
  /** Flujos inspiratorios al 25/50/75 % del FVC (valor absoluto, L/s). */
  fif25: number | null;
  fif50: number | null;
  fif75: number | null;
}

function interpVolumeAtTime(curve: SpiroPoint[], xTarget: number): number | null {
  if (curve.length < 2) return null;
  if (xTarget < curve[0].t || xTarget > curve[curve.length - 1].t) return null;
  let i = 1;
  while (i < curve.length && curve[i].t < xTarget) i++;
  if (i >= curve.length) return curve[curve.length - 1].v;
  const p0 = curve[i - 1];
  const p1 = curve[i];
  if (p1.t === p0.t) return p0.v;
  const t = (xTarget - p0.t) / (p1.t - p0.t);
  return p0.v + (p1.v - p0.v) * t;
}

function flowAtVolume(curve: SpiroPoint[], target: number): number | null {
  for (let i = 1; i < curve.length; i++) {
    const v0 = curve[i - 1].v;
    const v1 = curve[i].v;
    if (v0 <= target && v1 >= target && v1 !== v0) {
      const t = (target - v0) / (v1 - v0);
      return curve[i - 1].f + (curve[i].f - curve[i - 1].f) * t;
    }
  }
  return null;
}

/**
 * Flujo inspiratorio (negativo) cuando se ha vuelto a inhalar hasta el volumen
 * `target` (en la rama descendente posterior al pico de FVC).
 * Devuelve |flujo| en L/s, o null si la maniobra no tiene fase inspiratoria.
 */
function inspFlowAtVolume(curve: SpiroPoint[], target: number): number | null {
  // Localiza el índice del FVC (pico de volumen)
  let peakIdx = 0;
  for (let i = 1; i < curve.length; i++) {
    if (curve[i].v > curve[peakIdx].v) peakIdx = i;
  }
  if (peakIdx >= curve.length - 1) return null;
  // Recorrer la fase inspiratoria buscando cruces descendentes
  let best: number | null = null;
  for (let i = peakIdx + 1; i < curve.length; i++) {
    const v0 = curve[i - 1].v;
    const v1 = curve[i].v;
    if (v0 >= target && v1 <= target && v0 !== v1) {
      const t = (v0 - target) / (v0 - v1);
      const f = curve[i - 1].f + (curve[i].f - curve[i - 1].f) * t;
      if (f < 0) {
        const absF = Math.abs(f);
        if (best === null || absF > best) best = absF;
      }
    }
  }
  return best;
}

export function computeSpiroMetrics(
  curve: SpiroPoint[],
  markerA: number,
  markerB: number,
): SpiroMetrics | null {
  if (curve.length === 0) return null;
  const pef = curve.reduce((m, p) => (p.f > m ? p.f : m), -Infinity);
  const fvc = curve.reduce((m, p) => (p.v > m ? p.v : m), -Infinity);
  const fevA = interpVolumeAtTime(curve, markerA);
  const fevB = interpVolumeAtTime(curve, markerB);
  const fvcOk = Number.isFinite(fvc) && fvc > 0;
  return {
    pef: Number.isFinite(pef) ? pef : null,
    fvc: fvcOk ? fvc : null,
    fevA,
    fevB,
    deltaV: fevA !== null && fevB !== null ? Math.abs(fevB - fevA) : null,
    fef25: fvcOk ? flowAtVolume(curve, 0.25 * fvc) : null,
    fef50: fvcOk ? flowAtVolume(curve, 0.5 * fvc) : null,
    fef75: fvcOk ? flowAtVolume(curve, 0.75 * fvc) : null,
    fevAOverFvc: fevA !== null && fvcOk ? (fevA / fvc) * 100 : null,
    fif25: fvcOk ? inspFlowAtVolume(curve, 0.25 * fvc) : null,
    fif50: fvcOk ? inspFlowAtVolume(curve, 0.5 * fvc) : null,
    fif75: fvcOk ? inspFlowAtVolume(curve, 0.75 * fvc) : null,
  };
}

export interface SpiroGroupAverage {
  count: number;
  pef: number | null;
  fvc: number | null;
  fevA: number | null;
  fevB: number | null;
  fef25: number | null;
  fef50: number | null;
  fef75: number | null;
  fevAOverFvc: number | null;
  fif25: number | null;
  fif50: number | null;
  fif75: number | null;
}

function avg(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function averageMetrics(list: SpiroMetrics[]): SpiroGroupAverage {
  return {
    count: list.length,
    pef: avg(list.map((m) => m.pef)),
    fvc: avg(list.map((m) => m.fvc)),
    fevA: avg(list.map((m) => m.fevA)),
    fevB: avg(list.map((m) => m.fevB)),
    fef25: avg(list.map((m) => m.fef25)),
    fef50: avg(list.map((m) => m.fef50)),
    fef75: avg(list.map((m) => m.fef75)),
    fevAOverFvc: avg(list.map((m) => m.fevAOverFvc)),
    fif25: avg(list.map((m) => m.fif25)),
    fif50: avg(list.map((m) => m.fif50)),
    fif75: avg(list.map((m) => m.fif75)),
  };
}
