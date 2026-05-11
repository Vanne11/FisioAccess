import type { SpiroPoint, SpiroRecording, SpiroRefLines, SpiroMarkerLines } from "@/components/shared/SpiroCharts";

export type BronchodilatorStatus = "PRE" | "POST";

export type Sex = "Masculino" | "Femenino" | "Otro";

export const ETHNICITIES = [
  "Mestizo",
  "Mapuche",
  "Aymara",
  "Rapa Nui",
  "Diaguita",
  "Quechua",
  "Caucásico",
  "Otro",
] as const;

export type Ethnicity = (typeof ETHNICITIES)[number];

export interface SpiroPatient {
  nombre: string;
  rut: string;
  sexo: Sex;
  fechaNacimiento: string;
  edad: number;
  etnia: Ethnicity;
  estaturaCm: number;
  pesoKg: number;
  comentarios: string;
}

export interface SpiroAnalysis {
  interpretacion: string;
  conclusion: string;
}

export interface SpiroStoredRecording {
  recordingNumber: number;
  bronchodilatorStatus: BronchodilatorStatus;
  color: string;
  data: SpiroPoint[];
}

export interface SpiroLinePositions {
  markerA: number;
  markerB: number;
  refPef: number;
  refFvc: number;
}

export interface SpiroStudy {
  device: string;
  version: string;
  timestamp: string;
  patient: SpiroPatient;
  analysis: SpiroAnalysis;
  recordings: SpiroStoredRecording[];
  linePositions: Record<number, SpiroLinePositions>;
}

export const STUDY_DEVICE = "fisioaccess_espiro";
export const STUDY_VERSION = "1.0";

export function emptyPatient(): SpiroPatient {
  return {
    nombre: "",
    rut: "",
    sexo: "Masculino",
    fechaNacimiento: "",
    edad: 30,
    etnia: "Mestizo",
    estaturaCm: 170,
    pesoKg: 70,
    comentarios: "",
  };
}

export function emptyAnalysis(): SpiroAnalysis {
  return { interpretacion: "", conclusion: "" };
}

export function computeAgeFromBirth(yyyyMmDd: string): number | null {
  if (!yyyyMmDd) return null;
  const d = new Date(yyyyMmDd);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age <= 150 ? age : null;
}

export interface PatientValidationError {
  field: keyof SpiroPatient | keyof SpiroAnalysis;
  message: string;
}

export function validateStudy(
  patient: SpiroPatient,
  analysis: SpiroAnalysis,
): PatientValidationError[] {
  const errs: PatientValidationError[] = [];
  if (!patient.nombre.trim()) errs.push({ field: "nombre", message: "Nombre obligatorio" });
  if (!patient.rut.trim()) errs.push({ field: "rut", message: "RUT obligatorio" });
  if (!(patient.estaturaCm >= 50 && patient.estaturaCm <= 250))
    errs.push({ field: "estaturaCm", message: "Estatura entre 50 y 250 cm" });
  if (!(patient.pesoKg >= 10 && patient.pesoKg <= 300))
    errs.push({ field: "pesoKg", message: "Peso entre 10 y 300 kg" });
  if (!analysis.interpretacion.trim())
    errs.push({ field: "interpretacion", message: "Interpretación obligatoria" });
  if (!analysis.conclusion.trim())
    errs.push({ field: "conclusion", message: "Conclusión obligatoria" });
  return errs;
}

export interface BuildStudyInput {
  patient: SpiroPatient;
  analysis: SpiroAnalysis;
  recordings: SpiroRecording[];
  bronchodilatorByRec: Record<number, BronchodilatorStatus>;
  refLines: SpiroRefLines;
  markerLines: SpiroMarkerLines;
  timestamp?: string;
}

export function buildStudy(input: BuildStudyInput): SpiroStudy {
  const ts = input.timestamp ?? new Date().toISOString();
  const linePositions: Record<number, SpiroLinePositions> = {};
  for (const r of input.recordings) {
    linePositions[r.number] = {
      markerA: input.markerLines.a,
      markerB: input.markerLines.b,
      refPef: input.refLines.pef,
      refFvc: input.refLines.fvc,
    };
  }
  const stored: SpiroStoredRecording[] = input.recordings.map((r) => ({
    recordingNumber: r.number,
    bronchodilatorStatus: input.bronchodilatorByRec[r.id] ?? "PRE",
    color: r.color,
    data: r.data,
  }));
  return {
    device: STUDY_DEVICE,
    version: STUDY_VERSION,
    timestamp: ts,
    patient: input.patient,
    analysis: input.analysis,
    recordings: stored,
    linePositions,
  };
}

/**
 * Serializa a JSON con claves compatibles con el proyecto Python padre
 * (snake_case, vLine1/vLine2/v_line_pef/v_line_fvc, etc).
 */
export function studyToPythonJSON(s: SpiroStudy): string {
  const obj = {
    device: s.device,
    version: s.version,
    timestamp: s.timestamp,
    patient: {
      nombre: s.patient.nombre,
      rut: s.patient.rut,
      sexo: s.patient.sexo,
      fecha_nacimiento: s.patient.fechaNacimiento,
      edad: s.patient.edad,
      etnia: s.patient.etnia,
      estatura_cm: s.patient.estaturaCm,
      peso_kg: s.patient.pesoKg,
      comentarios: s.patient.comentarios,
    },
    analysis: {
      interpretacion: s.analysis.interpretacion,
      conclusion: s.analysis.conclusion,
    },
    recordings: s.recordings.map((r) => ({
      recording_number: r.recordingNumber,
      bronchodilator_status: r.bronchodilatorStatus,
      color: r.color,
      data: {
        t: r.data.map((p) => p.t),
        p: r.data.map((p) => p.p),
        f: r.data.map((p) => p.f),
        v: r.data.map((p) => p.v),
      },
    })),
    line_positions: Object.fromEntries(
      Object.entries(s.linePositions).map(([num, lp]) => [
        num,
        {
          vLine1: lp.markerA,
          vLine2: lp.markerB,
          v_line_pef: lp.refPef,
          v_line_fvc: lp.refFvc,
        },
      ]),
    ),
  };
  return JSON.stringify(obj, null, 2);
}

interface PythonStudyShape {
  device?: string;
  version?: string;
  timestamp?: string;
  patient?: Record<string, unknown>;
  analysis?: Record<string, unknown>;
  recordings?: Array<{
    recording_number?: number;
    bronchodilator_status?: string;
    color?: string;
    data?: { t?: number[]; p?: number[]; f?: number[]; v?: number[] };
  }>;
  line_positions?: Record<
    string,
    { vLine1?: number; vLine2?: number; v_line_pef?: number; v_line_fvc?: number }
  >;
}

export function studyFromPythonJSON(json: string): SpiroStudy {
  const obj = JSON.parse(json) as PythonStudyShape;
  const p = obj.patient ?? {};
  const patient: SpiroPatient = {
    nombre: String(p.nombre ?? ""),
    rut: String(p.rut ?? ""),
    sexo: (p.sexo as Sex) ?? "Masculino",
    fechaNacimiento: String(p.fecha_nacimiento ?? ""),
    edad: Number(p.edad ?? 0),
    etnia: ((p.etnia as Ethnicity) ?? "Mestizo") as Ethnicity,
    estaturaCm: Number(p.estatura_cm ?? 170),
    pesoKg: Number(p.peso_kg ?? 70),
    comentarios: String(p.comentarios ?? ""),
  };
  const a = obj.analysis ?? {};
  const analysis: SpiroAnalysis = {
    interpretacion: String(a.interpretacion ?? ""),
    conclusion: String(a.conclusion ?? ""),
  };
  const recordings: SpiroStoredRecording[] = (obj.recordings ?? []).map((r) => {
    const t = r.data?.t ?? [];
    const pa = r.data?.p ?? [];
    const f = r.data?.f ?? [];
    const v = r.data?.v ?? [];
    const n = Math.min(t.length, pa.length, f.length, v.length);
    const data: SpiroPoint[] = [];
    for (let i = 0; i < n; i++) {
      data.push({ t: t[i], p: pa[i], f: f[i], v: v[i] });
    }
    const status: BronchodilatorStatus = r.bronchodilator_status === "POST" ? "POST" : "PRE";
    return {
      recordingNumber: r.recording_number ?? 0,
      bronchodilatorStatus: status,
      color: r.color ?? "#06b6d4",
      data,
    };
  });
  const linePositions: Record<number, SpiroLinePositions> = {};
  for (const [k, lp] of Object.entries(obj.line_positions ?? {})) {
    const num = Number(k);
    if (!Number.isFinite(num)) continue;
    linePositions[num] = {
      markerA: Number(lp.vLine1 ?? 1.0),
      markerB: Number(lp.vLine2 ?? 2.0),
      refPef: Number(lp.v_line_pef ?? 1.5),
      refFvc: Number(lp.v_line_fvc ?? 4.0),
    };
  }
  return {
    device: obj.device ?? STUDY_DEVICE,
    version: obj.version ?? STUDY_VERSION,
    timestamp: obj.timestamp ?? new Date().toISOString(),
    patient,
    analysis,
    recordings,
    linePositions,
  };
}

export function studyFilename(patient: SpiroPatient, ts?: string): string {
  const date = ts ? new Date(ts) : new Date();
  const stamp =
    `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}` +
    `_${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
  const sanit = (s: string) => s.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 32);
  const nombre = sanit(patient.nombre) || "sinNombre";
  const rut = sanit(patient.rut) || "sinRut";
  return `${stamp}_${nombre}_${rut}_espiro.json`;
}
