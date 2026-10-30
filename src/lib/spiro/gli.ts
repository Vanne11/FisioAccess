import { GLI_AGE_MIN, GLI_AGE_STEP, GLI_GLOBAL_SPLINES } from "./gliGlobalData";
import { parseIsoDate, type SpiroPatient } from "./types";

/**
 * Valores teóricos GLI Global 2022 (race-neutral), método LMS:
 *   M = exp(a0 + a1·ln(talla cm) + a2·ln(edad) + Mspline)
 *   S = exp(b0 + b1·ln(edad) + Sspline)
 *   z = ((obs/M)^L − 1) / (L·S)          LIN = M·(1 − 1.645·L·S)^(1/L)
 * Coeficientes: Bowerman et al. AJRCCM 2023 (vía rspiro 0.5). Válido para
 * 3–95 años. Los splines se interpolan linealmente entre pasos de 0.25 años.
 */
export type GliParam = "fev1" | "fvc" | "fev1fvc";

export interface GliRef {
  /** Valor teórico (mediana, M). FEV1/FVC como fracción 0–1. */
  pred: number;
  /** Límite inferior normal (percentil 5, z = −1.645). */
  lln: number;
  L: number;
  M: number;
  S: number;
}

type Coef = { a: [number, number, number]; b: [number, number]; L: (lnAge: number) => number };

// [sexo 1 = masculino, 2 = femenino]
const COEF: Record<GliParam, Record<1 | 2, Coef>> = {
  fev1: {
    1: { a: [-11.399108, 2.462664, -0.011394], b: [-2.256278, 0.080729], L: () => 1.22703 },
    2: { a: [-10.901689, 2.385928, -0.076386], b: [-2.364047, 0.129402], L: () => 1.21388 },
  },
  fvc: {
    1: { a: [-12.629131, 2.727421, 0.009174], b: [-2.195595, 0.068466], L: () => 0.9346 },
    2: { a: [-12.055901, 2.621579, -0.035975], b: [-2.310148, 0.120428], L: () => 0.899 },
  },
  fev1fvc: {
    1: { a: [1.022608, -0.218592, -0.027586], b: [-2.882025, 0.068889], L: (la) => 3.8243 - 0.3328 * la },
    2: { a: [0.9189568, -0.1840671, -0.0461306], b: [-3.171582, 0.144358], L: (la) => 6.649 - 0.992 * la },
  },
};

export function gliGlobal(
  param: GliParam,
  sex: 1 | 2,
  ageYears: number,
  heightCm: number,
): GliRef | null {
  const table = GLI_GLOBAL_SPLINES[param][sex];
  const maxAge = GLI_AGE_MIN + GLI_AGE_STEP * (table.length - 1);
  if (!(ageYears >= GLI_AGE_MIN && ageYears <= maxAge) || !(heightCm > 0)) return null;
  const pos = (ageYears - GLI_AGE_MIN) / GLI_AGE_STEP;
  const i = Math.min(Math.floor(pos), table.length - 2);
  const w = pos - i;
  const mSpline = table[i][0] + (table[i + 1][0] - table[i][0]) * w;
  const sSpline = table[i][1] + (table[i + 1][1] - table[i][1]) * w;
  const c = COEF[param][sex];
  const lnAge = Math.log(ageYears);
  const M = Math.exp(c.a[0] + c.a[1] * Math.log(heightCm) + c.a[2] * lnAge + mSpline);
  const S = Math.exp(c.b[0] + c.b[1] * lnAge + sSpline);
  const L = c.L(lnAge);
  const lln = M * Math.pow(1 - 1.645 * L * S, 1 / L);
  return { pred: M, lln, L, M, S };
}

export function zScore(obs: number, r: GliRef): number {
  return (Math.pow(obs / r.M, r.L) - 1) / (r.L * r.S);
}

/** Edad decimal a la fecha `at` (GLI usa edad con decimales). */
export function decimalAge(birthYyyyMmDd: string, at: Date): number | null {
  const b = parseIsoDate(birthYyyyMmDd);
  if (!b) return null;
  const age = (at.getTime() - b.getTime()) / (365.25 * 24 * 3600 * 1000);
  return age > 0 ? age : null;
}

export type GliSet = Record<GliParam, GliRef>;

/**
 * Teóricos del paciente a la fecha del estudio. null si falta sexo biológico
 * (GLI no define ecuaciones para "Otro") o la edad cae fuera de 3–95 años.
 */
export function gliForPatient(p: SpiroPatient, at: Date): GliSet | null {
  const sex = p.sexo === "Masculino" ? 1 : p.sexo === "Femenino" ? 2 : null;
  if (sex === null) return null;
  const age = decimalAge(p.fechaNacimiento, at) ?? p.edad;
  const fev1 = gliGlobal("fev1", sex, age, p.estaturaCm);
  const fvc = gliGlobal("fvc", sex, age, p.estaturaCm);
  const fev1fvc = gliGlobal("fev1fvc", sex, age, p.estaturaCm);
  return fev1 && fvc && fev1fvc ? { fev1, fvc, fev1fvc } : null;
}

/**
 * Patrón ATS/ERS 2022 basado en z-scores (LIN = z −1.645):
 *   FEV1/FVC < LIN y FVC normal → obstrucción
 *   FEV1/FVC < LIN y FVC < LIN  → obstrucción con FVC disminuida
 *                                  (posible defecto mixto o atrapamiento aéreo)
 *   FEV1/FVC normal y FVC < LIN → patrón restrictivo posible
 *   FEV1/FVC y FVC normales, FEV1 < LIN → PRISm
 *   Severidad por z de FEV1: > −2.5 leve, −2.5 a −4 moderada, < −4 grave.
 * Restricción y defecto mixto requieren confirmar con volúmenes pulmonares.
 */
export function interpretZ(zFev1: number, zFvc: number, zRatio: number): string {
  const low = (z: number) => z < -1.645;
  const sev = zFev1 > -2.5 ? "leve" : zFev1 >= -4 ? "moderada" : "grave";
  if (low(zRatio) && low(zFvc))
    return `Obstrucción ${sev} con FVC disminuida (posible defecto mixto o atrapamiento aéreo; confirmar con volúmenes pulmonares)`;
  if (low(zRatio)) return `Obstrucción ${sev}`;
  if (low(zFvc)) return `Patrón restrictivo posible, ${sev} (confirmar con volúmenes pulmonares)`;
  if (low(zFev1)) return `Espirometría alterada con cociente conservado (PRISm), ${sev}`;
  return "Dentro de límites normales";
}
