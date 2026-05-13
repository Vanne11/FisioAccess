import type { SpiroMetrics } from "./metrics";

export type QualityGrade = "A" | "B" | "C" | "D" | "—";

export interface QualityResult {
  grade: QualityGrade;
  /** Maniobras aceptables (BEV pass + PEF válido) usadas para el grado. */
  nManeuvers: number;
  /** Maniobras rechazadas por BEV > máx(150 mL, 5 % FVC). */
  nRejectedBev: number;
  repeatabilityMl: number | null;
  pefValuesLs: number[];
}

export interface QualitySuggestion {
  removeRecordingNumber: number;
  newGrade: QualityGrade;
  newRepeatabilityMl: number | null;
}

/**
 * Criterio ATS/ERS de aceptabilidad por BEV (back-extrapolated volume):
 * BEV ≤ máx(150 mL, 5 % FVC). Si la maniobra no tiene back-extrap o FVC
 * válidos, se considera no-aceptable (true cuando ambos OK y BEV cumple).
 */
export function isBevAcceptable(m: SpiroMetrics): boolean {
  if (!m.backExtrap) return false;
  if (m.fvc === null || !Number.isFinite(m.fvc) || m.fvc <= 0) return false;
  const limit = Math.max(0.150, 0.05 * m.fvc);
  return m.backExtrap.bev <= limit;
}

/**
 * Grado de calidad ATS/ERS basado en la repetibilidad de PEF entre maniobras
 * *aceptables* (las que cumplen el criterio BEV). Mismos umbrales del proyecto
 * Python padre (150/200 mL).
 *
 *   n>=3 ∧ rep<150 ml → A
 *   n>=3 ∧ rep<200 ml → B
 *   n>=2 ∧ rep<200 ml → C
 *   n>=2             → D
 *   otherwise        → "—" (sin grado, faltan maniobras aceptables)
 */
export function computeQuality(metricsList: SpiroMetrics[]): QualityResult {
  const accepted: SpiroMetrics[] = [];
  let nRejectedBev = 0;
  for (const m of metricsList) {
    if (isBevAcceptable(m)) accepted.push(m);
    else nRejectedBev++;
  }
  const pefValuesLs = accepted
    .map((m) => m.pef)
    .filter((p): p is number => p !== null && Number.isFinite(p));
  const n = pefValuesLs.length;
  if (n < 2) {
    return { grade: "—", nManeuvers: n, nRejectedBev, repeatabilityMl: null, pefValuesLs };
  }
  const max = Math.max(...pefValuesLs);
  const min = Math.min(...pefValuesLs);
  const repeatabilityMl = (max - min) * 1000;
  let grade: QualityGrade;
  if (n >= 3 && repeatabilityMl < 150) grade = "A";
  else if (n >= 3 && repeatabilityMl < 200) grade = "B";
  else if (repeatabilityMl < 200) grade = "C";
  else grade = "D";
  return { grade, nManeuvers: n, nRejectedBev, repeatabilityMl, pefValuesLs };
}

const GRADE_ORDER: Record<QualityGrade, number> = {
  A: 4,
  B: 3,
  C: 2,
  D: 1,
  "—": 0,
};

/**
 * Sugerencias de eliminación: prueba quitar cada maniobra y reporta las que
 * mejoran el grado. Se devuelven ordenadas de mejor → peor.
 */
export function computeSuggestions(
  metricsList: SpiroMetrics[],
  recordingNumbers: number[],
): QualitySuggestion[] {
  if (metricsList.length !== recordingNumbers.length) return [];
  const base = computeQuality(metricsList);
  const baseScore = GRADE_ORDER[base.grade];
  const out: QualitySuggestion[] = [];
  for (let i = 0; i < metricsList.length; i++) {
    const subset = metricsList.filter((_, j) => j !== i);
    const q = computeQuality(subset);
    if (GRADE_ORDER[q.grade] > baseScore) {
      out.push({
        removeRecordingNumber: recordingNumbers[i],
        newGrade: q.grade,
        newRepeatabilityMl: q.repeatabilityMl,
      });
    }
  }
  out.sort((a, b) => GRADE_ORDER[b.newGrade] - GRADE_ORDER[a.newGrade]);
  return out;
}

export function gradeColorClasses(grade: QualityGrade): string {
  switch (grade) {
    case "A":
      return "bg-emerald-500/20 text-emerald-300";
    case "B":
      return "bg-lime-500/20 text-lime-300";
    case "C":
      return "bg-amber-500/20 text-amber-300";
    case "D":
      return "bg-red-500/20 text-red-300";
    default:
      return "bg-surface-700 text-secondary";
  }
}
