/** Tipos de marcador puntual */
export const POINT_TYPES = ["P", "Q", "R", "S", "T", "U"] as const;
export type PointType = (typeof POINT_TYPES)[number];

/** Tipos de intervalo / segmento */
export const INTERVAL_TYPES = ["PR", "ST", "QT", "RR"] as const;
export type IntervalType = (typeof INTERVAL_TYPES)[number];

export type MarkerToolType = PointType | IntervalType;

export interface PointMarker {
  id: string;
  kind: "point";
  type: PointType;
  timestamp_ms: number;
}

export interface IntervalMarker {
  id: string;
  kind: "interval";
  type: IntervalType;
  startMs: number;
  endMs: number;
}

export type ECGMarker = PointMarker | IntervalMarker;

// Colores por tipo de marcador
export const MARKER_COLORS: Record<MarkerToolType, string> = {
  P: "#60a5fa",   // blue
  Q: "#f97316",   // orange
  R: "#ef4444",   // red
  S: "#a855f7",   // purple
  T: "#22c55e",   // green
  U: "#06b6d4",   // cyan
  PR: "#60a5fa",
  ST: "#22c55e",
  QT: "#eab308",  // yellow
  RR: "#ef4444",
};

/** Complejo QRS detectado automaticamente a partir de marcas Q, R, S */
export interface QRSComplex {
  qId: string;
  rId: string;
  sId: string;
  qMs: number;
  rMs: number;
  sMs: number;
  durationMs: number; // S - Q
}

export const QRS_COLOR = "#f59e0b"; // amber

/**
 * Detecta complejos QRS agrupando marcas Q, R, S cercanas.
 * Reglas: Q < R < S, todos dentro de 300ms, cada marca usada una sola vez.
 */
export function detectQRSComplexes(markers: ECGMarker[]): QRSComplex[] {
  const qs = markers
    .filter((m): m is PointMarker => m.kind === "point" && m.type === "Q")
    .sort((a, b) => a.timestamp_ms - b.timestamp_ms);
  const rs = markers
    .filter((m): m is PointMarker => m.kind === "point" && m.type === "R")
    .sort((a, b) => a.timestamp_ms - b.timestamp_ms);
  const ss = markers
    .filter((m): m is PointMarker => m.kind === "point" && m.type === "S")
    .sort((a, b) => a.timestamp_ms - b.timestamp_ms);

  const usedR = new Set<string>();
  const usedS = new Set<string>();
  const complexes: QRSComplex[] = [];

  for (const q of qs) {
    // Buscar la R mas cercana despues de Q (dentro de 200ms)
    const r = rs.find(
      (r) =>
        !usedR.has(r.id) &&
        r.timestamp_ms > q.timestamp_ms &&
        r.timestamp_ms - q.timestamp_ms < 200,
    );
    if (!r) continue;

    // Buscar la S mas cercana despues de R (dentro de 200ms)
    const s = ss.find(
      (s) =>
        !usedS.has(s.id) &&
        s.timestamp_ms > r.timestamp_ms &&
        s.timestamp_ms - r.timestamp_ms < 200,
    );
    if (!s) continue;

    // QRS total debe ser <= 300ms
    const dur = s.timestamp_ms - q.timestamp_ms;
    if (dur > 300) continue;

    usedR.add(r.id);
    usedS.add(s.id);

    complexes.push({
      qId: q.id,
      rId: r.id,
      sId: s.id,
      qMs: q.timestamp_ms,
      rMs: r.timestamp_ms,
      sMs: s.timestamp_ms,
      durationMs: dur,
    });
  }

  return complexes;
}

let _id = 0;
export function nextMarkerId(): string {
  return `m${++_id}`;
}
