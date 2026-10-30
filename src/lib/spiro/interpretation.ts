import { gliForPatient, interpretZ, zScore, type GliSet } from "./gli";
import type { SpiroReported } from "./metrics";
import type { QualityResult } from "./quality";
import type { SpiroAnalysis, SpiroPatient } from "./types";

export interface BdDelta {
  ml: number;
  pct: number;
  /** Cambio como % del teórico GLI (criterio ATS/ERS 2022), null sin teóricos. */
  pctPred: number | null;
}

export interface BdResult {
  fev1: BdDelta | null;
  fvc: BdDelta | null;
  significant: boolean;
  criterion: "ATS/ERS 2022" | "ATS/ERS 2005";
}

/**
 * Respuesta broncodilatadora (mejor POST vs mejor PRE).
 *   Con teóricos: Δ > 10 % del teórico en FEV1 o FVC (ATS/ERS 2022).
 *   Sin teóricos: Δ ≥ 12 % y ≥ 200 mL en FEV1 o FVC (ATS/ERS 2005).
 */
export function bdResponse(
  pre: SpiroReported | null,
  post: SpiroReported | null,
  gli: GliSet | null,
): BdResult | null {
  const d = (a: number | null | undefined, b: number | null | undefined, pred: number | null): BdDelta | null =>
    a != null && b != null && a > 0
      ? { ml: (b - a) * 1000, pct: ((b - a) / a) * 100, pctPred: pred ? ((b - a) / pred) * 100 : null }
      : null;
  const fev1 = d(pre?.fev1, post?.fev1, gli?.fev1.pred ?? null);
  const fvc = d(pre?.fvc, post?.fvc, gli?.fvc.pred ?? null);
  if (!fev1 && !fvc) return null;
  const both = [fev1, fvc].filter((x): x is BdDelta => x !== null);
  return gli
    ? { fev1, fvc, significant: both.some((x) => x.pctPred! > 10), criterion: "ATS/ERS 2022" }
    : { fev1, fvc, significant: both.some((x) => x.ml >= 200 && x.pct >= 12), criterion: "ATS/ERS 2005" };
}

interface Group {
  reported: SpiroReported | null;
  quality: QualityResult;
}

const sign = (x: number) => (x >= 0 ? "+" : "");

function qualityLine(label: string, q: QualityResult): string {
  const reps = [
    q.fev1RepMl !== null ? `ΔFEV1 ${q.fev1RepMl.toFixed(0)} mL` : null,
    q.fvcRepMl !== null ? `ΔFVC ${q.fvcRepMl.toFixed(0)} mL` : null,
  ].filter(Boolean);
  return (
    `Calidad ${label}: grado ${q.grade} (${q.nManeuvers} maniobra${q.nManeuvers === 1 ? "" : "s"} aceptable${q.nManeuvers === 1 ? "" : "s"}` +
    (reps.length ? `; ${reps.join(", ")}` : "") +
    ")."
  );
}

function valuesLine(label: string, r: SpiroReported, gli: GliSet | null): string {
  const fmt = (v: number | null, k: keyof GliSet, unit: string, digits: number) => {
    if (v === null) return "—";
    const base = `${v.toFixed(digits)}${unit}`;
    return gli ? `${base} (${((v / gli[k].pred) * 100).toFixed(0)} % teór., z ${zScore(v, gli[k]).toFixed(1)})` : base;
  };
  const ratio = r.fev1OverFvc !== null ? r.fev1OverFvc / 100 : null;
  return (
    `${label}: FEV1 ${fmt(r.fev1, "fev1", " L", 2)}; FVC ${fmt(r.fvc, "fvc", " L", 2)}; ` +
    `FEV1/FVC ${fmt(ratio, "fev1fvc", "", 2)}` +
    (r.pef !== null ? `; PEF ${r.pef.toFixed(2)} L/s` : "") +
    (r.fef2575 !== null ? `; FEF25-75 ${r.fef2575.toFixed(2)} L/s` : "") +
    "."
  );
}

/**
 * Texto sugerido de interpretación y conclusión, al estilo de los
 * espirómetros comerciales: calidad + valores con % teórico y z + patrón
 * ATS/ERS 2022 (sobre PRE) + respuesta broncodilatadora. Es una propuesta
 * para que el profesional la revise y edite; no reemplaza su juicio.
 */
export function suggestAnalysis(
  patient: SpiroPatient,
  at: Date,
  pre: Group,
  post: Group,
): SpiroAnalysis {
  const gli = gliForPatient(patient, at);
  const lines: string[] = [];
  const conc: string[] = [];

  for (const [label, g] of [["PRE", pre], ["POST", post]] as const) {
    if (!g.reported) continue;
    lines.push(qualityLine(label, g.quality));
    lines.push(valuesLine(label, g.reported, gli));
  }

  const base = pre.reported ?? post.reported;
  if (!base) return { interpretacion: "", conclusion: "" };

  if (gli && base.fev1 !== null && base.fvc !== null && base.fev1OverFvc !== null) {
    const pattern = interpretZ(
      zScore(base.fev1, gli.fev1),
      zScore(base.fvc, gli.fvc),
      zScore(base.fev1OverFvc / 100, gli.fev1fvc),
    );
    conc.push(`Espirometría${pre.reported ? "" : " (solo POST)"}: ${pattern.charAt(0).toLowerCase()}${pattern.slice(1)}.`);
  } else {
    conc.push("Sin valores teóricos GLI (sexo no binario o edad fuera de 3–95 años): patrón a definir por el profesional.");
  }

  const bd = pre.reported && post.reported ? bdResponse(pre.reported, post.reported, gli) : null;
  if (bd) {
    const part = (lbl: string, x: BdDelta | null) =>
      x
        ? `${lbl} ${sign(x.ml)}${x.ml.toFixed(0)} mL (${sign(x.pct)}${x.pct.toFixed(1)} %` +
          (x.pctPred !== null ? `; ${sign(x.pctPred)}${x.pctPred.toFixed(1)} % del teórico` : "") +
          ")"
        : null;
    lines.push(
      `Respuesta broncodilatadora (${bd.criterion}): ` +
        [part("FEV1", bd.fev1), part("FVC", bd.fvc)].filter(Boolean).join("; ") +
        ".",
    );
    conc.push(`Respuesta broncodilatadora ${bd.significant ? "significativa" : "no significativa"}.`);
  }

  const worst = [pre, post].filter((g) => g.reported).map((g) => g.quality.grade);
  if (worst.some((g) => g === "D" || g === "E" || g === "F")) {
    conc.push("Calidad técnica limitada: interpretar con cautela.");
  }

  return { interpretacion: lines.join("\n"), conclusion: conc.join(" ") };
}
