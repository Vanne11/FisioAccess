import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { computeBackExtrap } from "@/lib/spiro/metrics";

/** Punto crudo de una espirometría: tiempo relativo en segundos. */
export interface SpiroPoint {
  t: number; // s
  p: number; // kPa
  f: number; // L/s
  v: number; // L
}

/**
 * Desplaza una curva al sistema de referencia clínico ATS/ERS:
 *   - t' = t − t0_be   (t' = 0 en el "time-zero" back-extrapolado)
 *   - v' = v − v0       (v' = 0 sobre la línea tangente proyectada)
 *
 * Si la curva no permite calcular back-extrap (pocos samples, sin flujo
 * positivo), se devuelve sin modificar. El flujo no cambia.
 */
function shiftCurve(pts: SpiroPoint[]): SpiroPoint[] {
  if (pts.length === 0) return pts;
  const be = computeBackExtrap(pts);
  if (!be) return pts;
  const dt = be.t0;
  const dv = be.v0;
  if (dt === 0 && dv === 0) return pts;
  return pts.map((p) => ({ t: p.t - dt, p: p.p, f: p.f, v: p.v - dv }));
}

export interface SpiroRecording {
  id: number;
  number: number;
  color: string;
  data: SpiroPoint[];
}

/** Mantenido para compatibilidad con el formato de estudio en disco —
 *  el chart F/V ya no usa estos valores: PEF y FVC se calculan
 *  automáticamente desde la curva. */
export interface SpiroRefLines {
  pef: number;
  fvc: number;
}

/** Cursores verticales en el chart Volumen/Tiempo para medir
 *  intervalos de la curva (FEV1, FEV0.5, etc). */
export interface SpiroMarkerLines {
  /** Tiempo (s) del cursor A. */
  a: number;
  /** Tiempo (s) del cursor B. */
  b: number;
}

interface SpiroChartsProps {
  current: SpiroPoint[];
  recordings: SpiroRecording[];
  markerLines: SpiroMarkerLines;
  onMarkerLinesChange: (next: SpiroMarkerLines) => void;
  /** Color de la curva actual; si se omite se usan los defaults
   *  (azul para V-t, verde para F-V). Útil para mostrar la curva
   *  seleccionada con el mismo color de su entrada en la lista. */
  currentColor?: string;
  /** Prueba activa (si la curva proviene de una grabación de la lista).
   *  Se usa para mostrar la entrada de leyenda con su número. */
  currentRecording?: SpiroRecording;
  /** Si se omite, el componente observa el alto disponible del
   *  contenedor padre y llena todo el espacio. */
  height?: number;
  /** Alto mínimo cuando la altura es dinámica. */
  minHeight?: number;
}

// Rangos de fallback cuando no hay datos (idle). Una vez hay muestras,
// los ejes se recalculan por autoscale para que cualquier curva
// (incluyendo marcadores y líneas de referencia) entre completa.
const VT_T_FALLBACK_MIN = 0;
const VT_T_FALLBACK_MAX = 6;
const VT_V_FALLBACK_MIN = -1;
const VT_V_FALLBACK_MAX = 5;

const FV_V_FALLBACK_MIN = 0;
const FV_V_FALLBACK_MAX = 5;
const FV_F_FALLBACK_MIN = -2;
const FV_F_FALLBACK_MAX = 8;

const MARGIN_LEFT = 44;
const MARGIN_BOTTOM = 26;
const MARGIN_TOP = 8;
const MARGIN_RIGHT = 8;

const COLOR_CURRENT_VT = "#3b82f6"; // azul
const COLOR_CURRENT_FV = "#10b981"; // verde (lazo F/V clínico)
const COLOR_FEF = "#3b82f6";        // azul — drop lines FEF (espiración)
const COLOR_FIF = "#ef4444";        // rojo — drop lines FIF (inspiración)
const COLOR_ANCHOR = "#fb923c";     // naranja — anclas PEF y FVC
const COLOR_EXP_LABEL = "#3b82f6";
const COLOR_INSP_LABEL = "#ef4444";
const COLOR_MARKER_A = "#ef4444"; // rojo
const COLOR_MARKER_B = "#10b981"; // verde
const COLOR_MARKER_DIFF = "#22d3ee"; // cyan

const REF_GRAB_PX = 6;
const FV_GRAB_PX = 10;

/** Interpola linealmente el volumen `v` en la curva al tiempo `x`.
 *  Devuelve null si `x` cae fuera del rango de la curva. */
function yAtX(pts: SpiroPoint[], x: number): number | null {
  if (pts.length < 2) return null;
  if (x < pts[0].t || x > pts[pts.length - 1].t) return null;
  let i = 1;
  while (i < pts.length && pts[i].t < x) i++;
  if (i >= pts.length) return pts[pts.length - 1].v;
  const p0 = pts[i - 1];
  const p1 = pts[i];
  if (p1.t === p0.t) return p0.v;
  const t = (x - p0.t) / (p1.t - p0.t);
  return p0.v + (p1.v - p0.v) * t;
}

/** Flujo en la curva cuando el volumen alcanza por primera vez `target`
 *  (rama espiratoria — volumen creciente). Devuelve null si la curva
 *  nunca llega a ese volumen. */
function flowAtV(pts: SpiroPoint[], target: number): number | null {
  for (let i = 1; i < pts.length; i++) {
    const v0 = pts[i - 1].v;
    const v1 = pts[i].v;
    if (v0 <= target && v1 >= target && v1 !== v0) {
      const t = (target - v0) / (v1 - v0);
      return pts[i - 1].f + (pts[i].f - pts[i - 1].f) * t;
    }
  }
  return null;
}

/** Flujo (con signo, negativo) en la rama inspiratoria al cruzar el
 *  volumen `target`. Busca cruces descendentes después del pico de FVC. */
function inspFlowAtV(pts: SpiroPoint[], target: number): number | null {
  if (pts.length < 2) return null;
  let peakIdx = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].v > pts[peakIdx].v) peakIdx = i;
  }
  if (peakIdx >= pts.length - 1) return null;
  for (let i = peakIdx + 1; i < pts.length; i++) {
    const v0 = pts[i - 1].v;
    const v1 = pts[i].v;
    if (v0 >= target && v1 <= target && v0 !== v1) {
      const t = (v0 - target) / (v0 - v1);
      const f = pts[i - 1].f + (pts[i].f - pts[i - 1].f) * t;
      if (f < 0) return f;
    }
  }
  return null;
}

/** Índice del punto de máximo flujo (PEF) de la rama espiratoria. */
function peakExpIndex(pts: SpiroPoint[]): number | null {
  if (pts.length === 0) return null;
  let idx = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].f > pts[idx].f) idx = i;
  }
  return pts[idx].f > 0 ? idx : null;
}

interface VtView {
  tMin: number;
  tMax: number;
  vMin: number;
  vMax: number;
}
interface FvView {
  vMin: number;
  vMax: number;
  fMin: number;
  fMax: number;
}

/** Padding mínimo para que un valor extremo no quede pegado al borde. */
const MIN_PAD_T = 0.3;
const MIN_PAD_V = 0.25;
const MIN_PAD_F = 0.5;
const PAD_FRAC = 0.08;

function themeColors() {
  const s = getComputedStyle(document.documentElement);
  const get = (v: string, fb: string) => s.getPropertyValue(v).trim() || fb;
  return {
    bg: get("--color-surface-950", "#020617"),
    label: get("--color-text-secondary", "#64748b"),
    grid: "rgba(148, 163, 184, 0.15)",
    axis: "rgba(148, 163, 184, 0.35)",
  };
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  ml: number,
  mt: number,
  plotW: number,
  plotH: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  xStep: number,
  yStep: number,
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax + 1e-9; x += xStep) {
    const px = ml + ((x - xMin) / (xMax - xMin)) * plotW;
    ctx.moveTo(px, mt);
    ctx.lineTo(px, mt + plotH);
  }
  for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax + 1e-9; y += yStep) {
    const py = mt + (1 - (y - yMin) / (yMax - yMin)) * plotH;
    ctx.moveTo(ml, py);
    ctx.lineTo(ml + plotW, py);
  }
  ctx.stroke();
}

function drawAxisLabels(
  ctx: CanvasRenderingContext2D,
  ml: number,
  mt: number,
  plotW: number,
  plotH: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  xStep: number,
  yStep: number,
  color: string,
  xLabel: string,
  yLabel: string,
) {
  ctx.fillStyle = color;
  ctx.font = "10px monospace";

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax + 1e-9; x += xStep) {
    const px = ml + ((x - xMin) / (xMax - xMin)) * plotW;
    ctx.fillText(Math.abs(x) < 1e-9 ? "0" : x.toString(), px, mt + plotH + 4);
  }

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax + 1e-9; y += yStep) {
    const py = mt + (1 - (y - yMin) / (yMax - yMin)) * plotH;
    ctx.fillText(Math.abs(y) < 1e-9 ? "0" : y.toString(), ml - 4, py);
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(yLabel, 2, 2);
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText(xLabel, ml + plotW - 2, mt + plotH + MARGIN_BOTTOM - 2);
}

function drawZeroLines(
  ctx: CanvasRenderingContext2D,
  ml: number,
  mt: number,
  plotW: number,
  plotH: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (yMin <= 0 && yMax >= 0) {
    const py = mt + (1 - (0 - yMin) / (yMax - yMin)) * plotH;
    ctx.moveTo(ml, py);
    ctx.lineTo(ml + plotW, py);
  }
  if (xMin <= 0 && xMax >= 0) {
    const px = ml + ((0 - xMin) / (xMax - xMin)) * plotW;
    ctx.moveTo(px, mt);
    ctx.lineTo(px, mt + plotH);
  }
  ctx.stroke();
}

/** Leyenda compacta de pruebas en una esquina del chart.
 *  `items` se renderiza en orden, cada uno con un cuadrado del color
 *  de la curva, su nombre y un indicador opcional de "activa". */
function drawLegend(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  items: Array<{ color: string; label: string; active?: boolean }>,
) {
  if (items.length === 0) return;
  ctx.save();
  ctx.font = "10px monospace";
  const lineH = 12;
  const swatch = 8;
  const padX = 5;
  const padY = 4;
  // Calcula ancho según la entrada más larga
  let maxW = 0;
  for (const it of items) {
    const w = ctx.measureText(it.label + (it.active ? "  ●" : "")).width;
    if (w > maxW) maxW = w;
  }
  const boxW = swatch + 4 + maxW + padX * 2;
  const boxH = items.length * lineH + padY * 2 - 2;
  ctx.fillStyle = "rgba(15, 23, 42, 0.78)";
  ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.rect(x, y, boxW, boxH);
  ctx.fill();
  ctx.stroke();
  let cy = y + padY + lineH * 0.5 + 1;
  for (const it of items) {
    ctx.fillStyle = it.color;
    ctx.fillRect(x + padX, cy - swatch / 2, swatch, swatch);
    ctx.fillStyle = it.active ? "#f8fafc" : "#cbd5e1";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(it.label, x + padX + swatch + 4, cy);
    if (it.active) {
      ctx.fillStyle = it.color;
      ctx.fillText("●", x + padX + swatch + 4 + maxW - 6, cy);
    }
    cy += lineH;
  }
  ctx.restore();
}

function drawSeries(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  ml: number,
  mt: number,
  plotW: number,
  plotH: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  color: string,
  dashed: boolean,
) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(ml, mt, plotW, plotH);
  ctx.clip();

  ctx.strokeStyle = color;
  ctx.lineWidth = dashed ? 1 : 1.6;
  ctx.setLineDash(dashed ? [4, 3] : []);
  ctx.lineJoin = "round";
  ctx.beginPath();
  let started = false;
  for (const pt of pts) {
    const px = ml + ((pt.x - xMin) / (xMax - xMin)) * plotW;
    const py = mt + (1 - (pt.y - yMin) / (yMax - yMin)) * plotH;
    if (!started) {
      ctx.moveTo(px, py);
      started = true;
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

interface ChartPanelProps {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  onMouseDown?: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseMove?: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseUp?: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onWheel?: (e: React.WheelEvent<HTMLCanvasElement>) => void;
  onDoubleClick?: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  cursor?: string;
  canvasRef?: React.Ref<HTMLCanvasElement>;
}

function ChartPanel({ width, height, draw, onMouseDown, onMouseMove, onMouseUp, onWheel, onDoubleClick, cursor, canvasRef }: ChartPanelProps) {
  const innerRef = useRef<HTMLCanvasElement>(null);
  const refToUse = (canvasRef ?? innerRef) as React.RefObject<HTMLCanvasElement>;

  useEffect(() => {
    const canvas = refToUse.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, width, height);
  }, [draw, width, height, refToUse]);

  // React onWheel es passive por defecto en algunos browsers, lo cual
  // ignora preventDefault(). Para evitar el scroll de la página cuando
  // se hace wheel sobre el canvas, registramos manualmente non-passive.
  useEffect(() => {
    const canvas = refToUse.current;
    if (!canvas || !onWheel) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      onWheel(e as unknown as React.WheelEvent<HTMLCanvasElement>);
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, [onWheel, refToUse]);

  return (
    <canvas
      ref={refToUse}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onDoubleClick={onDoubleClick}
      style={{ cursor: cursor ?? "default", display: "block" }}
    />
  );
}

export function SpiroCharts({
  current,
  recordings,
  markerLines,
  onMarkerLinesChange,
  currentColor,
  currentRecording,
  height,
  minHeight = 240,
}: SpiroChartsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const fvCanvasRef = useRef<HTMLCanvasElement>(null);
  const vtCanvasRef = useRef<HTMLCanvasElement>(null);

  // Curvas en sistema de referencia clínico ATS/ERS: cada una se desplaza
  // por su propio t0_be / v0 para que t'=0, v'=0 corresponda al
  // "time-zero" back-extrapolado. Toda la lógica de render, autoscale,
  // marcadores y anclas opera sobre estas curvas desplazadas; markerLines
  // y refLines son valores en este sistema (= segundos / litros desde la
  // referencia clínica).
  const shiftedCurrent = useMemo(() => shiftCurve(current), [current]);
  const shiftedRecordings = useMemo(
    () => recordings.map((r) => ({ ...r, data: shiftCurve(r.data) })),
    [recordings],
  );

  // Viewports derivados por autoscale: se recalculan en cada render según
  // datos + marcadores + líneas de referencia, garantizando que las
  // curvas siempre entren completas en el recuadro. Sin estado mutable
  // → no se "descuadra" con interacciones del usuario.
  const allCurves = useMemo(() => {
    const list: SpiroPoint[][] = [];
    if (shiftedCurrent.length > 0) list.push(shiftedCurrent);
    for (const r of shiftedRecordings) if (r.data.length > 0) list.push(r.data);
    return list;
  }, [shiftedCurrent, shiftedRecordings]);

  const vtView = useMemo<VtView>(() => {
    let tMin = Infinity;
    let tMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const pts of allCurves) {
      for (const p of pts) {
        if (p.t < tMin) tMin = p.t;
        if (p.t > tMax) tMax = p.t;
        if (p.v < vMin) vMin = p.v;
        if (p.v > vMax) vMax = p.v;
      }
    }
    // Si no hay datos, valores de fallback
    if (!Number.isFinite(tMin)) {
      tMin = VT_T_FALLBACK_MIN;
      tMax = VT_T_FALLBACK_MAX;
      vMin = VT_V_FALLBACK_MIN;
      vMax = VT_V_FALLBACK_MAX;
    }
    // Marcadores A/B deben entrar siempre
    tMin = Math.min(tMin, markerLines.a, markerLines.b, 0);
    tMax = Math.max(tMax, markerLines.a, markerLines.b);
    // Volumen siempre incluye 0 como referencia visual
    vMin = Math.min(vMin, 0);
    vMax = Math.max(vMax, 0);
    const padT = Math.max(MIN_PAD_T, (tMax - tMin) * PAD_FRAC);
    const padV = Math.max(MIN_PAD_V, (vMax - vMin) * PAD_FRAC);
    return { tMin: tMin - padT, tMax: tMax + padT, vMin: vMin - padV, vMax: vMax + padV };
  }, [allCurves, markerLines]);

  // Anclas PEF y FVC arrastrables horizontalmente, en volúmenes absolutos
  // independientes (como en la versión original). PEF se autocalcula al
  // volumen del pico real de la curva; el usuario puede ajustarlo.
  // FEF/FIF 25/50/75 % se reparten en cuartos entre PEF y FVC — al mover
  // cualquiera de las dos anclas, las 6 drop-lines se redistribuyen en
  // paralelo manteniendo las proporciones.
  type FvKey = "pef" | "fvc";
  const autoFvc = useMemo(() => {
    if (shiftedCurrent.length === 0) return null;
    const v = shiftedCurrent.reduce((m, p) => (p.v > m ? p.v : m), -Infinity);
    return Number.isFinite(v) && v > 0 ? v : null;
  }, [shiftedCurrent]);
  const autoPefVol = useMemo(() => {
    const i = peakExpIndex(shiftedCurrent);
    return i !== null ? shiftedCurrent[i].v : null;
  }, [shiftedCurrent]);
  const [fvcOverride, setFvcOverride] = useState<number | null>(null);
  const [pefOverride, setPefOverride] = useState<number | null>(null);
  useEffect(() => {
    setFvcOverride(null);
    setPefOverride(null);
  }, [current]);

  const fvcVol = fvcOverride ?? autoFvc ?? 0;
  const hasFvc = fvcVol > 0;
  const pefVol = pefOverride ?? autoPefVol ?? 0;
  const pefFlow = autoPefVol !== null ? (flowAtV(shiftedCurrent, pefVol) ?? 0) : 0;
  const hasPef = autoPefVol !== null;
  const fefStep = (fvcVol - pefVol) / 4;
  const fefVols = {
    fef25: pefVol + fefStep,
    fef50: pefVol + fefStep * 2,
    fef75: pefVol + fefStep * 3,
  };
  const fifVols = {
    fif25: pefVol + fefStep,
    fif50: pefVol + fefStep * 2,
    fif75: pefVol + fefStep * 3,
  };

  const fvView = useMemo<FvView>(() => {
    let vMin = Infinity;
    let vMax = -Infinity;
    let fMin = Infinity;
    let fMax = -Infinity;
    for (const pts of allCurves) {
      for (const p of pts) {
        if (p.v < vMin) vMin = p.v;
        if (p.v > vMax) vMax = p.v;
        if (p.f < fMin) fMin = p.f;
        if (p.f > fMax) fMax = p.f;
      }
    }
    if (!Number.isFinite(vMin)) {
      vMin = FV_V_FALLBACK_MIN;
      vMax = FV_V_FALLBACK_MAX;
      fMin = FV_F_FALLBACK_MIN;
      fMax = FV_F_FALLBACK_MAX;
    }
    // Volumen y flujo siempre incluyen 0 como referencia visual
    vMin = Math.min(vMin, 0);
    vMax = Math.max(vMax, 0);
    fMin = Math.min(fMin, 0);
    fMax = Math.max(fMax, 0);
    // Asegurar que PEF y FVC (incluso si el usuario los arrastró fuera
    // del rango de la curva) permanezcan dentro del recuadro visible.
    if (hasFvc) {
      vMin = Math.min(vMin, fvcVol);
      vMax = Math.max(vMax, fvcVol);
    }
    if (hasPef) {
      vMin = Math.min(vMin, pefVol);
      vMax = Math.max(vMax, pefVol);
    }
    const padV = Math.max(MIN_PAD_V, (vMax - vMin) * PAD_FRAC);
    const padF = Math.max(MIN_PAD_F, (fMax - fMin) * PAD_FRAC);
    return { vMin: vMin - padV, vMax: vMax + padV, fMin: fMin - padF, fMax: fMax + padF };
  }, [allCurves, hasFvc, fvcVol, hasPef, pefVol]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const containerWidth = containerSize.w;
  const effectiveHeight = height ?? Math.max(minHeight, containerSize.h);
  const TITLE_H = 20;
  const chartHeight = Math.max(80, effectiveHeight - TITLE_H);

  const vtWidth = Math.max(200, Math.floor((containerWidth * 2) / 3) - 4);
  const fvWidth = Math.max(160, containerWidth - vtWidth - 8);

  // Items de la leyenda: prueba activa (si la hay) marcada + resto de
  // grabaciones. Ordenados por número de prueba para coincidir con el
  // panel lateral.
  const legendItems = useMemo(() => {
    type Item = { color: string; label: string; active?: boolean; number: number };
    const items: Item[] = [];
    if (currentRecording) {
      items.push({
        color: currentRecording.color,
        label: `Prueba ${currentRecording.number}`,
        active: true,
        number: currentRecording.number,
      });
    }
    for (const r of recordings) {
      items.push({
        color: r.color,
        label: `Prueba ${r.number}`,
        number: r.number,
      });
    }
    items.sort((a, b) => a.number - b.number);
    return items.map(({ color, label, active }) => ({ color, label, active }));
  }, [currentRecording, recordings]);

  // ── Canvas Volumen / Tiempo ───────────────────────────────────────
  const drawVT = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const theme = themeColors();
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, w, h);

      const plotW = w - MARGIN_LEFT - MARGIN_RIGHT;
      const plotH = h - MARGIN_TOP - MARGIN_BOTTOM;
      const { tMin, tMax, vMin, vMax } = vtView;
      const xStep = (tMax - tMin) > 10 ? 2 : (tMax - tMin) > 3 ? 1 : 0.5;
      const yStep = (vMax - vMin) > 6 ? 1 : 0.5;

      drawGrid(ctx, MARGIN_LEFT, MARGIN_TOP, plotW, plotH,
        tMin, tMax, vMin, vMax, xStep, yStep, theme.grid);
      drawZeroLines(ctx, MARGIN_LEFT, MARGIN_TOP, plotW, plotH,
        tMin, tMax, vMin, vMax, theme.axis);

      // Curvas pasadas (discontinuas)
      for (const rec of shiftedRecordings) {
        const pts = rec.data.map(p => ({ x: p.t, y: p.v }));
        drawSeries(ctx, pts, MARGIN_LEFT, MARGIN_TOP, plotW, plotH,
          tMin, tMax, vMin, vMax, rec.color, true);
      }

      // Curva actual (color personalizado si la prueba seleccionada lo define)
      const pts = shiftedCurrent.map(p => ({ x: p.t, y: p.v }));
      drawSeries(ctx, pts, MARGIN_LEFT, MARGIN_TOP, plotW, plotH,
        tMin, tMax, vMin, vMax, currentColor ?? COLOR_CURRENT_VT, false);

      // ── Marcadores verticales A y B (cursor medidor) ───────────
      const xToPx = (x: number) =>
        MARGIN_LEFT + ((x - tMin) / (tMax - tMin)) * plotW;
      const yToPx = (y: number) =>
        MARGIN_TOP + (1 - (y - vMin) / (vMax - vMin)) * plotH;

      ctx.save();
      ctx.beginPath();
      ctx.rect(MARGIN_LEFT, MARGIN_TOP, plotW, plotH);
      ctx.clip();

      const markers: Array<{ x: number; color: string; label: "A" | "B" }> = [
        { x: markerLines.a, color: COLOR_MARKER_A, label: "A" },
        { x: markerLines.b, color: COLOR_MARKER_B, label: "B" },
      ];
      const yValues: Array<number | null> = [];
      for (const m of markers) {
        const px = xToPx(m.x);
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px, MARGIN_TOP);
        ctx.lineTo(px, MARGIN_TOP + plotH);
        ctx.stroke();

        const y = yAtX(shiftedCurrent, m.x);
        yValues.push(y);

        // Punto sobre la curva (si interpola dentro de rango)
        if (y !== null) {
          ctx.fillStyle = m.color;
          ctx.beginPath();
          ctx.arc(px, yToPx(y), 3, 0, Math.PI * 2);
          ctx.fill();
        }

        // Etiqueta X/Y al lado de la línea
        ctx.fillStyle = m.color;
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        const lblX = px + 4;
        const lblY = MARGIN_TOP + 2;
        ctx.fillText(`${m.label} t:${m.x.toFixed(2)}`, lblX, lblY);
        if (y !== null) {
          ctx.fillText(`v:${y.toFixed(2)}`, lblX, lblY + 11);
        }
      }

      // Etiqueta de diferencia entre A y B
      const [yA, yB] = yValues;
      if (yA !== null && yB !== null) {
        const dx = Math.abs(markerLines.b - markerLines.a);
        const dy = Math.abs(yB - yA);
        const xMid = (markerLines.a + markerLines.b) / 2;
        const pxMid = xToPx(xMid);
        ctx.fillStyle = COLOR_MARKER_DIFF;
        ctx.font = "bold 10px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(`Δt:${dx.toFixed(2)}s  Δv:${dy.toFixed(2)}L`, pxMid, MARGIN_TOP + plotH - 4);
      }
      ctx.restore();

      drawAxisLabels(ctx, MARGIN_LEFT, MARGIN_TOP, plotW, plotH,
        tMin, tMax, vMin, vMax, xStep, yStep,
        theme.label, "t (s)", "V (L)");

      // Leyenda en la esquina superior derecha del plot
      if (legendItems.length > 0) {
        drawLegend(ctx, MARGIN_LEFT + plotW - 95, MARGIN_TOP + 4, legendItems);
      }
    },
    [shiftedCurrent, shiftedRecordings, markerLines, vtView, currentColor, legendItems],
  );

  // ── Canvas Flujo / Volumen ────────────────────────────────────────
  const drawFV = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const theme = themeColors();
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, w, h);

      const plotW = w - MARGIN_LEFT - MARGIN_RIGHT;
      const plotH = h - MARGIN_TOP - MARGIN_BOTTOM;
      const { vMin, vMax, fMin, fMax } = fvView;
      const xStep = (vMax - vMin) > 6 ? 1 : 0.5;
      const yStep = (fMax - fMin) > 12 ? 2 : 1;

      drawGrid(ctx, MARGIN_LEFT, MARGIN_TOP, plotW, plotH,
        vMin, vMax, fMin, fMax, xStep, yStep, theme.grid);
      drawZeroLines(ctx, MARGIN_LEFT, MARGIN_TOP, plotW, plotH,
        vMin, vMax, fMin, fMax, theme.axis);

      for (const rec of shiftedRecordings) {
        const pts = rec.data.map(p => ({ x: p.v, y: p.f }));
        drawSeries(ctx, pts, MARGIN_LEFT, MARGIN_TOP, plotW, plotH,
          vMin, vMax, fMin, fMax, rec.color, true);
      }

      const pts = shiftedCurrent.map(p => ({ x: p.v, y: p.f }));
      drawSeries(ctx, pts, MARGIN_LEFT, MARGIN_TOP, plotW, plotH,
        vMin, vMax, fMin, fMax, currentColor ?? COLOR_CURRENT_FV, false);

      const xToPx = (x: number) =>
        MARGIN_LEFT + ((x - vMin) / (vMax - vMin)) * plotW;
      const yToPx = (y: number) =>
        MARGIN_TOP + (1 - (y - fMin) / (fMax - fMin)) * plotH;

      const hasInsp = shiftedCurrent.some((p) => p.f < -0.2);

      ctx.save();
      ctx.beginPath();
      ctx.rect(MARGIN_LEFT, MARGIN_TOP, plotW, plotH);
      ctx.clip();

      // Drop lines FEF 25 / 50 / 75 (rama espiratoria, azul)
      if (hasFvc) {
        const lines: Array<{ vol: number; lbl: string }> = [
          { vol: fefVols.fef25, lbl: "FEF25%" },
          { vol: fefVols.fef50, lbl: "FEF50%" },
          { vol: fefVols.fef75, lbl: "FEF75%" },
        ];
        for (const { vol, lbl } of lines) {
          const flow = flowAtV(shiftedCurrent, vol);
          if (flow === null || flow <= 0) continue;
          const px = xToPx(vol);
          const yZero = yToPx(0);
          const yCurve = yToPx(flow);
          ctx.strokeStyle = COLOR_FEF;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(px, yZero);
          ctx.lineTo(px, yCurve);
          ctx.stroke();
          ctx.fillStyle = COLOR_FEF;
          ctx.font = "bold 10px monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(lbl, px, yCurve - 3);
        }
      }

      // Drop lines FIF 25 / 50 / 75 (rama inspiratoria, rojo)
      if (hasFvc && hasInsp) {
        const lines: Array<{ vol: number; lbl: string }> = [
          { vol: fifVols.fif25, lbl: "FIF25%" },
          { vol: fifVols.fif50, lbl: "FIF50%" },
          { vol: fifVols.fif75, lbl: "FIF75%" },
        ];
        for (const { vol, lbl } of lines) {
          const flow = inspFlowAtV(shiftedCurrent, vol);
          if (flow === null || flow >= 0) continue;
          const px = xToPx(vol);
          const yZero = yToPx(0);
          const yCurve = yToPx(flow);
          ctx.strokeStyle = COLOR_FIF;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(px, yZero);
          ctx.lineTo(px, yCurve);
          ctx.stroke();
          ctx.fillStyle = COLOR_FIF;
          ctx.font = "bold 10px monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(lbl, px, yCurve + 3);
        }
      }

      // Ancla PEF (pico espiratorio, naranja, arrastrable)
      if (hasPef) {
        const px = xToPx(pefVol);
        const py = yToPx(pefFlow);
        ctx.strokeStyle = COLOR_ANCHOR;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(px, MARGIN_TOP);
        ctx.lineTo(px, MARGIN_TOP + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = COLOR_ANCHOR;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = COLOR_ANCHOR;
        ctx.font = "bold 10px monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(`PEF ${pefFlow.toFixed(2)}`, px + 8, py);
      }

      // Ancla FVC (extremo derecho sobre el eje x, naranja, arrastrable)
      if (hasFvc) {
        const px = xToPx(fvcVol);
        const py = yToPx(0);
        ctx.strokeStyle = COLOR_ANCHOR;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(px, MARGIN_TOP);
        ctx.lineTo(px, MARGIN_TOP + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = COLOR_ANCHOR;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = COLOR_ANCHOR;
        ctx.font = "bold 10px monospace";
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.fillText(`FVC ${fvcVol.toFixed(2)}`, px - 5, py - 5);
      }
      ctx.restore();

      // Etiquetas "Espiración" / "Inspiración" verticales al borde izquierdo
      const labelX = MARGIN_LEFT + 6;
      if (fMax > 0) {
        const yExpMid = MARGIN_TOP + ((fMax - fMax * 0.55) / (fMax - fMin)) * plotH;
        ctx.save();
        ctx.translate(labelX, yExpMid);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = COLOR_EXP_LABEL;
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText("Espiración", 0, 0);
        ctx.restore();
      }
      if (hasInsp && fMin < 0) {
        const yInspMid = MARGIN_TOP + ((fMax - fMin * 0.55) / (fMax - fMin)) * plotH;
        ctx.save();
        ctx.translate(labelX, yInspMid);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = COLOR_INSP_LABEL;
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText("Inspiración", 0, 0);
        ctx.restore();
      }

      drawAxisLabels(ctx, MARGIN_LEFT, MARGIN_TOP, plotW, plotH,
        vMin, vMax, fMin, fMax, xStep, yStep,
        theme.label, "V (L)", "Flujo (L/s)");

      // Leyenda en la esquina superior derecha del plot
      if (legendItems.length > 0) {
        drawLegend(ctx, MARGIN_LEFT + plotW - 95, MARGIN_TOP + 4, legendItems);
      }
    },
    [shiftedCurrent, shiftedRecordings, fvView, currentColor, hasPef, pefVol, pefFlow, hasFvc, fvcVol, fefVols, fifVols, legendItems],
  );

  // ── Drag de líneas en el canvas Flujo/Volumen ─────────────────────
  // Cada línea (PEF, FVC, FEF25/50/75, FIF25/50/75) puede arrastrarse
  // horizontalmente. La tolerancia de agarre es generosa (10 px).
  const fvDragRef = useRef<FvKey | null>(null);
  const [fvCursor, setFvCursor] = useState("default");

  const fvFromMouse = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = fvCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const plotW = fvWidth - MARGIN_LEFT - MARGIN_RIGHT;
    const v = fvView.vMin + ((px - MARGIN_LEFT) / plotW) * (fvView.vMax - fvView.vMin);
    const pxPerL = plotW / (fvView.vMax - fvView.vMin);
    return { v, px, pxPerL };
  }, [fvWidth, fvView]);

  // Devuelve la línea draggable (PEF o FVC) más cercana al volumen `v`
  // dentro de la tolerancia de agarre, o null si ninguna está al alcance.
  const findNearestLine = useCallback(
    (v: number, pxPerL: number): FvKey | null => {
      const grab = FV_GRAB_PX / pxPerL;
      const candidates: Array<[FvKey, number, boolean]> = [
        ["pef", pefVol, hasPef],
        ["fvc", fvcVol, hasFvc],
      ];
      let best: FvKey | null = null;
      let bestD = grab;
      for (const [key, vol, enabled] of candidates) {
        if (!enabled) continue;
        const d = Math.abs(v - vol);
        if (d < bestD) {
          bestD = d;
          best = key;
        }
      }
      return best;
    },
    [hasPef, pefVol, hasFvc, fvcVol],
  );

  const handleFVDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const m = fvFromMouse(e);
    if (!m) return;
    const key = findNearestLine(m.v, m.pxPerL);
    if (key !== null) {
      fvDragRef.current = key;
      setFvCursor("ew-resize");
    }
  }, [fvFromMouse, findNearestLine]);

  const handleFVMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const m = fvFromMouse(e);
    if (!m) return;
    const dragging = fvDragRef.current;
    if (dragging) {
      const clamped = Math.max(0, m.v);
      if (dragging === "fvc") {
        // FVC siempre a la derecha de PEF (con un pequeño margen)
        setFvcOverride(Math.max(pefVol + 0.05, clamped));
      } else {
        // PEF a la izquierda de FVC
        setPefOverride(Math.max(0, Math.min(fvcVol - 0.05, clamped)));
      }
      return;
    }
    const key = findNearestLine(m.v, m.pxPerL);
    setFvCursor(key !== null ? "ew-resize" : "default");
  }, [fvFromMouse, findNearestLine, fvcVol, pefVol]);

  const handleFVUp = useCallback(() => {
    fvDragRef.current = null;
    setFvCursor("default");
  }, []);

  // ── Drag de marcadores A / B en el canvas Volumen/Tiempo ─────────
  const vtDragRef = useRef<{ which: "a" | "b" } | null>(null);
  const [vtCursor, setVtCursor] = useState("default");

  const vtFromMouse = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = vtCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const plotW = vtWidth - MARGIN_LEFT - MARGIN_RIGHT;
    const plotH = canvas.clientHeight - MARGIN_TOP - MARGIN_BOTTOM;
    const t = vtView.tMin + ((px - MARGIN_LEFT) / plotW) * (vtView.tMax - vtView.tMin);
    const v = vtView.vMax - ((py - MARGIN_TOP) / plotH) * (vtView.vMax - vtView.vMin);
    const pxPerS = plotW / (vtView.tMax - vtView.tMin);
    return { t, v, px, py, pxPerS };
  }, [vtWidth, vtView]);

  const handleVTDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const m = vtFromMouse(e);
    if (!m) return;
    const grabS = REF_GRAB_PX / m.pxPerS;
    const dA = Math.abs(m.t - markerLines.a);
    const dB = Math.abs(m.t - markerLines.b);
    if (dA < grabS && dA <= dB) {
      vtDragRef.current = { which: "a" };
      setVtCursor("ew-resize");
    } else if (dB < grabS) {
      vtDragRef.current = { which: "b" };
      setVtCursor("ew-resize");
    }
  }, [markerLines, vtFromMouse]);

  const handleVTMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const m = vtFromMouse(e);
    if (!m) return;
    if (vtDragRef.current) {
      const clamped = Math.max(vtView.tMin, Math.min(vtView.tMax, m.t));
      if (vtDragRef.current.which === "a") {
        onMarkerLinesChange({ a: clamped, b: markerLines.b });
      } else {
        onMarkerLinesChange({ a: markerLines.a, b: clamped });
      }
      return;
    }
    const grabS = REF_GRAB_PX / m.pxPerS;
    if (Math.abs(m.t - markerLines.a) < grabS || Math.abs(m.t - markerLines.b) < grabS) {
      setVtCursor("ew-resize");
    } else {
      setVtCursor("default");
    }
  }, [markerLines, vtFromMouse, onMarkerLinesChange, vtView]);

  const handleVTUp = useCallback(() => {
    vtDragRef.current = null;
    setVtCursor("default");
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: height ?? "100%", minHeight, position: "relative" }}
      className="flex gap-2"
    >
      {containerWidth > 0 && (
        <>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                height: TITLE_H,
                width: vtWidth,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: "var(--color-text-secondary, #94a3b8)",
              }}
            >
              Volumen / Tiempo
            </div>
            <ChartPanel
              width={vtWidth}
              height={chartHeight}
              draw={drawVT}
              onMouseDown={handleVTDown}
              onMouseMove={handleVTMove}
              onMouseUp={handleVTUp}
              cursor={vtCursor}
              canvasRef={vtCanvasRef}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                height: TITLE_H,
                width: fvWidth,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: "var(--color-text-secondary, #94a3b8)",
              }}
            >
              Flujo / Volumen
            </div>
            <ChartPanel
              width={fvWidth}
              height={chartHeight}
              draw={drawFV}
              onMouseDown={handleFVDown}
              onMouseMove={handleFVMove}
              onMouseUp={handleFVUp}
              cursor={fvCursor}
              canvasRef={fvCanvasRef}
            />
          </div>
        </>
      )}
    </div>
  );
}
