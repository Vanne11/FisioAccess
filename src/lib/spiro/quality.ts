import type { SpiroMetrics } from "./metrics";

export type QualityGrade = "A" | "B" | "C" | "D" | "E" | "F";

export interface QualityResult {
  /** Grado global = el peor entre el grado de FEV1 y el de FVC. */
  grade: QualityGrade;
  /** Maniobras aceptables (cumplen BEV). */
  nManeuvers: number;
  /** Maniobras rechazadas por BEV > máx(100 mL, 5 % FVC). */
  nRejectedBev: number;
  /** Peor repetibilidad entre FEV1 y FVC (mL). */
  repeatabilityMl: number | null;
  fev1RepMl: number | null;
  fvcRepMl: number | null;
}

export interface QualitySuggestion {
  removeRecordingNumber: number;
  newGrade: QualityGrade;
  newRepeatabilityMl: number | null;
}

/** Límite ATS/ERS 2019 de BEV: máx(100 mL, 5 % FVC), en L. */
export function bevLimit(fvc: number | null): number {
  return fvc !== null && Number.isFinite(fvc) ? Math.max(0.1, 0.05 * fvc) : 0.1;
}

/**
 * Aceptabilidad por BEV (ATS/ERS 2019): BEV ≤ máx(100 mL, 5 % FVC). Sin
 * back-extrap o FVC válidos la maniobra no es aceptable.
 */
export function isBevAcceptable(m: SpiroMetrics): boolean {
  if (!m.backExtrap) return false;
  if (m.fvc === null || !Number.isFinite(m.fvc) || m.fvc <= 0) return false;
  return m.backExtrap.bev <= bevLimit(m.fvc);
}

/** Diferencia entre los dos valores más altos (mL), o null si hay < 2. */
function topTwoDiffMl(values: Array<number | null>): number | null {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x)).sort((a, b) => b - a);
  return v.length >= 2 ? (v[0] - v[1]) * 1000 : null;
}

/** Grado ATS/ERS 2019 para un parámetro (FEV1 o FVC), edad > 6 años. */
function gradeFor(n: number, repMl: number | null): QualityGrade {
  if (n === 0) return "F";
  if (n === 1 || repMl === null) return "E";
  if (n >= 3 && repMl <= 150) return "A";
  if (repMl <= 150) return "B";
  if (repMl <= 200) return "C";
  if (repMl <= 250) return "D";
  return "E";
}

/**
 * Grado de calidad ATS/ERS 2019 a partir de la repetibilidad de FEV1 y FVC
 * (diferencia entre los dos mayores valores) en maniobras aceptables:
 *   A: ≥3 aceptables, ≤150 mL · B: ≥2, ≤150 · C: ≥2, ≤200 · D: ≥2, ≤250
 *   E: ≥2 con >250 mL, o 1 aceptable · F: ninguna aceptable
 * ponytail: criterios pediátricos (≤6 años: 100 mL o 10 %) no implementados.
 */
export function computeQuality(metricsList: SpiroMetrics[]): QualityResult {
  const accepted = metricsList.filter(isBevAcceptable);
  const n = accepted.length;
  const fev1RepMl = topTwoDiffMl(accepted.map((m) => m.fev1));
  const fvcRepMl = topTwoDiffMl(accepted.map((m) => m.fvc));
  const gFev1 = gradeFor(n, fev1RepMl);
  const gFvc = gradeFor(n, fvcRepMl);
  const grade = GRADE_ORDER[gFev1] <= GRADE_ORDER[gFvc] ? gFev1 : gFvc;
  const reps = [fev1RepMl, fvcRepMl].filter((x): x is number => x !== null);
  return {
    grade,
    nManeuvers: n,
    nRejectedBev: metricsList.length - n,
    repeatabilityMl: reps.length > 0 ? Math.max(...reps) : null,
    fev1RepMl,
    fvcRepMl,
  };
}

const GRADE_ORDER: Record<QualityGrade, number> = {
  A: 5,
  B: 4,
  C: 3,
  D: 2,
  E: 1,
  F: 0,
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
      return "bg-orange-500/20 text-orange-300";
    case "E":
    case "F":
      return "bg-red-500/20 text-red-300";
    default:
      return "bg-surface-700 text-secondary";
  }
}
