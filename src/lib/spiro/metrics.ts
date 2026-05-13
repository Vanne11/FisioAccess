import type { SpiroPoint } from "@/components/shared/SpiroCharts";

/**
 * Resultado de back-extrapolación (ATS/ERS 2019, Standardization of Spirometry).
 *
 *   t0_be = t_PEF − V(t_PEF) / f_PEF
 *
 * Es el tiempo (en coords del propio registro) en que la tangente al volumen
 * en el punto de flujo máximo cruzaría V = 0. Define el "time-zero" clínico
 * desde el cual se mide FEV(t). El BEV (back-extrapolated volume) es el
 * volumen ya exhalado en t0_be — debe ser < max(150 mL, 5 % FVC).
 */
export interface SpiroBackExtrap {
  /** Tiempo cero back-extrapolado en las coords del registro (s). Puede ser < 0. */
  t0: number;
  /** Volumen de la curva en t0 (offset a sustraer de FVC y FEV) (L). */
  v0: number;
  /** Back-extrapolated volume = v0 (L). Criterio ATS/ERS: < max(0.150, 0.05·FVC). */
  bev: number;
}

export interface SpiroMetrics {
  pef: number | null;
  fvc: number | null;
  /** FEV1: volumen exhalado en 1.0 s desde el back-extrap zero (ATS/ERS). */
  fev1: number | null;
  /** Tiffeneau: FEV1 / FVC × 100 (%). */
  fev1OverFvc: number | null;
  /** Mediciones libres con los cursores A/B (V a `markerA` y `markerB` segundos
   *  después de t0_be). Útiles para FEV0.5, FEV3, FEV6, etc. */
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
  /** Parámetros de back-extrapolación. null si la curva no permite calcularlos. */
  backExtrap: SpiroBackExtrap | null;
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

/**
 * Calcula t0 back-extrapolado y el offset volumétrico para llevar la curva
 * a la referencia clínica ATS/ERS. Devuelve null si no se puede localizar
 * un pico de flujo positivo.
 */
export function computeBackExtrap(curve: SpiroPoint[]): SpiroBackExtrap | null {
  if (curve.length < 2) return null;
  let peakIdx = 0;
  for (let i = 1; i < curve.length; i++) {
    if (curve[i].f > curve[peakIdx].f) peakIdx = i;
  }
  const fPef = curve[peakIdx].f;
  const vPef = curve[peakIdx].v;
  const tPef = curve[peakIdx].t;
  if (!(fPef > 0) || !Number.isFinite(fPef)) return null;
  const t0 = tPef - vPef / fPef;
  // Offset volumétrico: V de la curva en t0. Si t0 cae antes del primer
  // sample (lo habitual: el trigger arranca con v>0, así que t0 < 0), el
  // firmware había zerificado el volumen — usamos 0. Si t0 cae dentro
  // del rango, interpolamos.
  let v0: number;
  if (t0 < curve[0].t) {
    v0 = 0;
  } else if (t0 > curve[curve.length - 1].t) {
    return null;
  } else {
    v0 = interpVolumeAtTime(curve, t0) ?? 0;
  }
  return { t0, v0, bev: v0 };
}

export function computeSpiroMetrics(
  curve: SpiroPoint[],
  markerA: number,
  markerB: number,
): SpiroMetrics | null {
  if (curve.length === 0) return null;

  const be = computeBackExtrap(curve);
  const t0 = be?.t0 ?? 0;
  const v0 = be?.v0 ?? 0;

  // PEF: máximo flujo (la translación temporal/volumétrica no lo altera).
  const pefRaw = curve.reduce((m, p) => (p.f > m ? p.f : m), -Infinity);
  const pef = Number.isFinite(pefRaw) ? pefRaw : null;

  // FVC: máximo volumen exhalado relativo a la referencia back-extrapolada.
  const vMaxRaw = curve.reduce((m, p) => (p.v > m ? p.v : m), -Infinity);
  const fvcRaw = Number.isFinite(vMaxRaw) ? vMaxRaw - v0 : NaN;
  const fvc = Number.isFinite(fvcRaw) && fvcRaw > 0 ? fvcRaw : null;
  const fvcOk = fvc !== null;

  // FEV(t): volumen exhalado en `t` segundos *desde t0_be*.
  //   FEV(t) = V_curve(t0_be + t) − V_curve(t0_be) = V_curve(t0_be + t) − v0
  const vAtAbs = (absT: number) => interpVolumeAtTime(curve, absT);
  const fevAt = (seconds: number): number | null => {
    const v = vAtAbs(t0 + seconds);
    return v !== null ? v - v0 : null;
  };

  // FEV1: canónico ATS/ERS — 1.0 s después del back-extrap zero.
  const fev1 = fevAt(1.0);

  // Cursores libres A/B (mediciones a voluntad: FEV0.5, FEV3, FEV6, etc.)
  const fevA = fevAt(markerA);
  const fevB = fevAt(markerB);

  // FEF25/50/75: flujo cuando el volumen *corregido* cruza X % del FVC.
  // En coords originales eso es X·FVC + v0.
  const flowAtCorrFvcFrac = (frac: number) =>
    fvcOk ? flowAtVolume(curve, frac * fvc + v0) : null;

  // FIF25/50/75: igual referencia (ATS/ERS recomienda mismo X% del FVC).
  const inspFlowAtCorrFvcFrac = (frac: number) =>
    fvcOk ? inspFlowAtVolume(curve, frac * fvc + v0) : null;

  return {
    pef,
    fvc,
    fev1,
    fev1OverFvc: fev1 !== null && fvcOk ? (fev1 / fvc) * 100 : null,
    fevA,
    fevB,
    deltaV: fevA !== null && fevB !== null ? Math.abs(fevB - fevA) : null,
    fef25: flowAtCorrFvcFrac(0.25),
    fef50: flowAtCorrFvcFrac(0.5),
    fef75: flowAtCorrFvcFrac(0.75),
    fevAOverFvc: fevA !== null && fvcOk ? (fevA / fvc) * 100 : null,
    fif25: inspFlowAtCorrFvcFrac(0.25),
    fif50: inspFlowAtCorrFvcFrac(0.5),
    fif75: inspFlowAtCorrFvcFrac(0.75),
    backExtrap: be,
  };
}

export interface SpiroGroupAverage {
  count: number;
  pef: number | null;
  fvc: number | null;
  fev1: number | null;
  fev1OverFvc: number | null;
  fevA: number | null;
  fevB: number | null;
  fef25: number | null;
  fef50: number | null;
  fef75: number | null;
  fevAOverFvc: number | null;
  fif25: number | null;
  fif50: number | null;
  fif75: number | null;
  /** Mejor FEV1 del grupo (L) — ATS/ERS recomienda reportar el best. */
  bestFev1: number | null;
  /** Mejor FVC del grupo (L). */
  bestFvc: number | null;
  /** Ratio clínico de referencia: mejor FEV1 / mejor FVC × 100. */
  bestFev1OverBestFvc: number | null;
  /** Mejor FEV(A) (cursor libre) — útil cuando se mide FEV0.5/FEV3/etc. */
  bestFevA: number | null;
  bestFevAOverBestFvc: number | null;
}

function avg(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function max(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (nums.length === 0) return null;
  return Math.max(...nums);
}

export function averageMetrics(list: SpiroMetrics[]): SpiroGroupAverage {
  const bestFev1 = max(list.map((m) => m.fev1));
  const bestFvc = max(list.map((m) => m.fvc));
  const bestFevA = max(list.map((m) => m.fevA));
  const ratio = (num: number | null, den: number | null) =>
    num !== null && den !== null && den > 0 ? (num / den) * 100 : null;
  return {
    count: list.length,
    pef: avg(list.map((m) => m.pef)),
    fvc: avg(list.map((m) => m.fvc)),
    fev1: avg(list.map((m) => m.fev1)),
    fev1OverFvc: avg(list.map((m) => m.fev1OverFvc)),
    fevA: avg(list.map((m) => m.fevA)),
    fevB: avg(list.map((m) => m.fevB)),
    fef25: avg(list.map((m) => m.fef25)),
    fef50: avg(list.map((m) => m.fef50)),
    fef75: avg(list.map((m) => m.fef75)),
    fevAOverFvc: avg(list.map((m) => m.fevAOverFvc)),
    fif25: avg(list.map((m) => m.fif25)),
    fif50: avg(list.map((m) => m.fif50)),
    fif75: avg(list.map((m) => m.fif75)),
    bestFev1,
    bestFvc,
    bestFev1OverBestFvc: ratio(bestFev1, bestFvc),
    bestFevA,
    bestFevAOverBestFvc: ratio(bestFevA, bestFvc),
  };
}
