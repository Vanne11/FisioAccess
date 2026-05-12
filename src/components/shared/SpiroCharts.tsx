import { useRef, useEffect, useCallback, useState } from "react";

/** Punto crudo de una espirometría: tiempo relativo en segundos. */
export interface SpiroPoint {
  t: number; // s
  p: number; // kPa
  f: number; // L/s
  v: number; // L
}

export interface SpiroRecording {
  id: number;
  number: number;
  color: string;
  data: SpiroPoint[];
}

export interface SpiroRefLines {
  /** Volumen (L) en el que está PEF. */
  pef: number;
  /** Volumen (L) en el que está FVC. */
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
  refLines: SpiroRefLines;
  onRefLinesChange: (next: SpiroRefLines) => void;
  markerLines: SpiroMarkerLines;
  onMarkerLinesChange: (next: SpiroMarkerLines) => void;
  /** Color de la curva actual; si se omite se usan los defaults
   *  (azul para V-t, rojo para F-V). Útil para mostrar la curva
   *  seleccionada con el mismo color de su entrada en la lista. */
  currentColor?: string;
  /** Si se omite, el componente observa el alto disponible del
   *  contenedor padre y llena todo el espacio. */
  height?: number;
  /** Alto mínimo cuando la altura es dinámica. */
  minHeight?: number;
}

// Rangos fijos por estándar médico (no autoscale)
const VT_T_MIN = 0;
const VT_T_MAX = 17;
const VT_V_MIN = -4;
const VT_V_MAX = 6;

const FV_V_MIN = 0;
const FV_V_MAX = 8;
const FV_F_MIN = -8;
const FV_F_MAX = 10;

const MARGIN_LEFT = 44;
const MARGIN_BOTTOM = 26;
const MARGIN_TOP = 8;
const MARGIN_RIGHT = 8;

const COLOR_CURRENT_VT = "#3b82f6"; // azul
const COLOR_CURRENT_FV = "#ef4444"; // rojo
const COLOR_REF_DRAG = "#a855f7";
const COLOR_REF_AUTO = "#94a3b8";
const COLOR_MARKER_A = "#ef4444"; // rojo
const COLOR_MARKER_B = "#10b981"; // verde
const COLOR_MARKER_DIFF = "#22d3ee"; // cyan

const REF_GRAB_PX = 6;

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

/** Flujo en la curva cuando el volumen alcanza por primera vez `target`.
 *  Devuelve null si la curva nunca llega a ese volumen. Coincide con
 *  la lógica usada en lib/spiro/metrics.flowAtVolume. */
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
const DEFAULT_VT_VIEW: VtView = { tMin: VT_T_MIN, tMax: VT_T_MAX, vMin: VT_V_MIN, vMax: VT_V_MAX };
const DEFAULT_FV_VIEW: FvView = { vMin: FV_V_MIN, vMax: FV_V_MAX, fMin: FV_F_MIN, fMax: FV_F_MAX };

const MIN_SPAN_T = 0.5; // s
const MIN_SPAN_V = 0.5; // L
const MIN_SPAN_F = 1.0; // L/s
const MAX_SPAN_T = 30;
const MAX_SPAN_V = 20;
const MAX_SPAN_F = 30;

function zoomRange(
  min: number,
  max: number,
  center: number,
  factor: number,
  minSpan: number,
  maxSpan: number,
): [number, number] {
  let span = (max - min) * factor;
  span = Math.max(minSpan, Math.min(maxSpan, span));
  const ratio = (center - min) / (max - min);
  let nMin = center - span * ratio;
  let nMax = center + span * (1 - ratio);
  return [nMin, nMax];
}

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

export interface SpiroChartsHandle {
  resetZoom: () => void;
}

export function SpiroCharts({
  current,
  recordings,
  refLines,
  onRefLinesChange,
  markerLines,
  onMarkerLinesChange,
  currentColor,
  height,
  minHeight = 240,
}: SpiroChartsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const fvCanvasRef = useRef<HTMLCanvasElement>(null);
  const vtCanvasRef = useRef<HTMLCanvasElement>(null);

  // Viewports independientes para zoom/pan; no modifican datos.
  const [vtView, setVtView] = useState<VtView>(DEFAULT_VT_VIEW);
  const [fvView, setFvView] = useState<FvView>(DEFAULT_FV_VIEW);
  const resetZoom = useCallback(() => {
    setVtView(DEFAULT_VT_VIEW);
    setFvView(DEFAULT_FV_VIEW);
  }, []);
  const isVtZoomed =
    vtView.tMin !== DEFAULT_VT_VIEW.tMin ||
    vtView.tMax !== DEFAULT_VT_VIEW.tMax ||
    vtView.vMin !== DEFAULT_VT_VIEW.vMin ||
    vtView.vMax !== DEFAULT_VT_VIEW.vMax;
  const isFvZoomed =
    fvView.vMin !== DEFAULT_FV_VIEW.vMin ||
    fvView.vMax !== DEFAULT_FV_VIEW.vMax ||
    fvView.fMin !== DEFAULT_FV_VIEW.fMin ||
    fvView.fMax !== DEFAULT_FV_VIEW.fMax;
  const isZoomed = isVtZoomed || isFvZoomed;

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

  // PEF y FVC los mueve el usuario; FEF25/50/75 se derivan repartiendo
  // el intervalo (FVC − PEF) en cuartos.
  const pef = refLines.pef;
  const fvc = refLines.fvc;
  const diff = (fvc - pef) / 4;
  const fef25 = pef + diff;
  const fef50 = pef + diff * 2;
  const fef75 = pef + diff * 3;

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
      for (const rec of recordings) {
        const pts = rec.data.map(p => ({ x: p.t, y: p.v }));
        drawSeries(ctx, pts, MARGIN_LEFT, MARGIN_TOP, plotW, plotH,
          tMin, tMax, vMin, vMax, rec.color, true);
      }

      // Curva actual (color personalizado si la prueba seleccionada lo define)
      const pts = current.map(p => ({ x: p.t, y: p.v }));
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

        const y = yAtX(current, m.x);
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
    },
    [current, recordings, markerLines, vtView, currentColor],
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

      for (const rec of recordings) {
        const pts = rec.data.map(p => ({ x: p.v, y: p.f }));
        drawSeries(ctx, pts, MARGIN_LEFT, MARGIN_TOP, plotW, plotH,
          vMin, vMax, fMin, fMax, rec.color, true);
      }

      const pts = current.map(p => ({ x: p.v, y: p.f }));
      drawSeries(ctx, pts, MARGIN_LEFT, MARGIN_TOP, plotW, plotH,
        vMin, vMax, fMin, fMax, currentColor ?? COLOR_CURRENT_FV, false);

      // Líneas de referencia verticales: PEF/FVC arrastrables (sólidas);
      // FEF25/50/75 derivadas (discontinuas). Labels rotados 90° para
      // que nunca se solapen aunque las líneas estén juntas. Muestran
      // volumen + flujo de la curva actual en ese volumen.
      ctx.save();
      ctx.beginPath();
      ctx.rect(MARGIN_LEFT, MARGIN_TOP, plotW, plotH);
      ctx.clip();
      const refs = [
        { x: pef, label: "PEF", draggable: true },
        { x: fef25, label: "FEF25", draggable: false },
        { x: fef50, label: "FEF50", draggable: false },
        { x: fef75, label: "FEF75", draggable: false },
        { x: fvc, label: "FVC", draggable: true },
      ];
      for (const r of refs) {
        if (r.x < vMin || r.x > vMax) continue;
        const px = MARGIN_LEFT + ((r.x - vMin) / (vMax - vMin)) * plotW;
        const color = r.draggable ? COLOR_REF_DRAG : COLOR_REF_AUTO;
        ctx.strokeStyle = color;
        ctx.lineWidth = r.draggable ? 1.5 : 1;
        ctx.setLineDash(r.draggable ? [] : [3, 3]);
        ctx.beginPath();
        ctx.moveTo(px, MARGIN_TOP);
        ctx.lineTo(px, MARGIN_TOP + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
        // Flujo en este volumen sobre la curva actual (coincide con el panel)
        const f = flowAtV(current, r.x);
        const valueText =
          f !== null && Number.isFinite(f)
            ? `${r.label}  v:${r.x.toFixed(2)}L  f:${f.toFixed(2)}L/s`
            : `${r.label}  v:${r.x.toFixed(2)}L`;
        ctx.save();
        ctx.translate(px + 3, MARGIN_TOP + 4);
        ctx.rotate(Math.PI / 2);
        ctx.fillStyle = color;
        ctx.font = `bold ${r.draggable ? 10 : 9}px monospace`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(valueText, 0, 0);
        ctx.restore();
      }
      ctx.restore();

      drawAxisLabels(ctx, MARGIN_LEFT, MARGIN_TOP, plotW, plotH,
        vMin, vMax, fMin, fMax, xStep, yStep,
        theme.label, "V (L)", "Flujo (L/s)");
    },
    [current, recordings, pef, fvc, fef25, fef50, fef75, fvView, currentColor],
  );

  // ── Drag de PEF / FVC en el canvas Flujo/Volumen ─────────────────
  const dragRef = useRef<{ which: "pef" | "fvc" } | null>(null);
  const [cursor, setCursor] = useState("default");
  // ── Drag de marcadores A / B en el canvas Volumen/Tiempo ─────────
  const vtDragRef = useRef<{ which: "a" | "b" } | null>(null);
  const [vtCursor, setVtCursor] = useState("default");
  // Pan (shift+drag o middle button): mueve el viewport, no los datos
  const fvPanRef = useRef<{ startV: number; startF: number; view: FvView } | null>(null);
  const vtPanRef = useRef<{ startT: number; startV: number; view: VtView } | null>(null);

  const fvFromMouse = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = fvCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const plotW = fvWidth - MARGIN_LEFT - MARGIN_RIGHT;
    const plotH = canvas.clientHeight - MARGIN_TOP - MARGIN_BOTTOM;
    const v = fvView.vMin + ((px - MARGIN_LEFT) / plotW) * (fvView.vMax - fvView.vMin);
    const f = fvView.fMax - ((py - MARGIN_TOP) / plotH) * (fvView.fMax - fvView.fMin);
    const pxPerL = plotW / (fvView.vMax - fvView.vMin);
    return { v, f, px, py, plotW, plotH, pxPerL };
  }, [fvWidth, fvView]);

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

  const handleFVDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const m = fvFromMouse(e);
    if (!m) return;
    // Shift+click o botón medio → pan
    if (e.shiftKey || e.button === 1) {
      fvPanRef.current = { startV: m.v, startF: m.f, view: fvView };
      setCursor("grabbing");
      return;
    }
    const grabL = REF_GRAB_PX / m.pxPerL;
    if (Math.abs(m.v - pef) < grabL) {
      dragRef.current = { which: "pef" };
      setCursor("ew-resize");
    } else if (Math.abs(m.v - fvc) < grabL) {
      dragRef.current = { which: "fvc" };
      setCursor("ew-resize");
    }
  }, [pef, fvc, fvFromMouse, fvView]);

  const handleFVMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const m = fvFromMouse(e);
    if (!m) return;
    if (fvPanRef.current) {
      // Mover el viewport en sentido inverso al delta del cursor
      const v0 = fvPanRef.current.startV;
      const f0 = fvPanRef.current.startF;
      const base = fvPanRef.current.view;
      const dv = m.v - v0;
      const df = m.f - f0;
      setFvView({
        vMin: base.vMin - dv,
        vMax: base.vMax - dv,
        fMin: base.fMin - df,
        fMax: base.fMax - df,
      });
      return;
    }
    if (dragRef.current) {
      const clamped = Math.max(fvView.vMin, Math.min(fvView.vMax, m.v));
      if (dragRef.current.which === "pef") {
        onRefLinesChange({ pef: Math.min(clamped, fvc - 0.05), fvc });
      } else {
        onRefLinesChange({ pef, fvc: Math.max(clamped, pef + 0.05) });
      }
      return;
    }
    const grabL = REF_GRAB_PX / m.pxPerL;
    if (Math.abs(m.v - pef) < grabL || Math.abs(m.v - fvc) < grabL) {
      setCursor("ew-resize");
    } else if (e.shiftKey) {
      setCursor("grab");
    } else {
      setCursor("default");
    }
  }, [pef, fvc, fvFromMouse, onRefLinesChange, fvView]);

  const handleFVUp = useCallback(() => {
    dragRef.current = null;
    fvPanRef.current = null;
    setCursor("default");
  }, []);

  const handleFVWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const m = fvFromMouse(e as unknown as React.MouseEvent<HTMLCanvasElement>);
    if (!m) return;
    const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    setFvView((v) => {
      const [vMin, vMax] = zoomRange(v.vMin, v.vMax, m.v, factor, MIN_SPAN_V, MAX_SPAN_V);
      const [fMin, fMax] = zoomRange(v.fMin, v.fMax, m.f, factor, MIN_SPAN_F, MAX_SPAN_F);
      return { vMin, vMax, fMin, fMax };
    });
  }, [fvFromMouse]);

  const handleFVDoubleClick = useCallback(() => {
    setFvView(DEFAULT_FV_VIEW);
  }, []);

  const handleVTDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const m = vtFromMouse(e);
    if (!m) return;
    if (e.shiftKey || e.button === 1) {
      vtPanRef.current = { startT: m.t, startV: m.v, view: vtView };
      setVtCursor("grabbing");
      return;
    }
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
  }, [markerLines, vtFromMouse, vtView]);

  const handleVTMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const m = vtFromMouse(e);
    if (!m) return;
    if (vtPanRef.current) {
      const t0 = vtPanRef.current.startT;
      const v0 = vtPanRef.current.startV;
      const base = vtPanRef.current.view;
      const dt = m.t - t0;
      const dv = m.v - v0;
      setVtView({
        tMin: base.tMin - dt,
        tMax: base.tMax - dt,
        vMin: base.vMin - dv,
        vMax: base.vMax - dv,
      });
      return;
    }
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
    } else if (e.shiftKey) {
      setVtCursor("grab");
    } else {
      setVtCursor("default");
    }
  }, [markerLines, vtFromMouse, onMarkerLinesChange, vtView]);

  const handleVTUp = useCallback(() => {
    vtDragRef.current = null;
    vtPanRef.current = null;
    setVtCursor("default");
  }, []);

  const handleVTWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const m = vtFromMouse(e as unknown as React.MouseEvent<HTMLCanvasElement>);
    if (!m) return;
    const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    setVtView((v) => {
      const [tMin, tMax] = zoomRange(v.tMin, v.tMax, m.t, factor, MIN_SPAN_T, MAX_SPAN_T);
      const [vMin, vMax] = zoomRange(v.vMin, v.vMax, m.v, factor, MIN_SPAN_V, MAX_SPAN_V);
      return { tMin, tMax, vMin, vMax };
    });
  }, [vtFromMouse]);

  const handleVTDoubleClick = useCallback(() => {
    setVtView(DEFAULT_VT_VIEW);
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
              onWheel={handleVTWheel}
              onDoubleClick={handleVTDoubleClick}
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
              onWheel={handleFVWheel}
              onDoubleClick={handleFVDoubleClick}
              cursor={cursor}
              canvasRef={fvCanvasRef}
            />
          </div>
        </>
      )}
      {isZoomed && (
        <button
          onClick={resetZoom}
          title="Restablecer zoom (también doble click sobre el gráfico)"
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            fontSize: 10,
            padding: "2px 8px",
            borderRadius: 4,
            background: "rgba(15, 23, 42, 0.85)",
            color: "#e2e8f0",
            border: "1px solid rgba(148, 163, 184, 0.4)",
            cursor: "pointer",
          }}
        >
          Reset zoom
        </button>
      )}
    </div>
  );
}
