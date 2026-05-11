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
  cursor?: string;
  canvasRef?: React.Ref<HTMLCanvasElement>;
}

function ChartPanel({ width, height, draw, onMouseDown, onMouseMove, onMouseUp, cursor, canvasRef }: ChartPanelProps) {
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

  return (
    <canvas
      ref={refToUse}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      style={{ cursor: cursor ?? "default", display: "block" }}
    />
  );
}

export function SpiroCharts({
  current,
  recordings,
  refLines,
  onRefLinesChange,
  markerLines,
  onMarkerLinesChange,
  height,
  minHeight = 240,
}: SpiroChartsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const fvCanvasRef = useRef<HTMLCanvasElement>(null);
  const vtCanvasRef = useRef<HTMLCanvasElement>(null);

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

      drawGrid(ctx, MARGIN_LEFT, MARGIN_TOP, plotW, plotH,
        VT_T_MIN, VT_T_MAX, VT_V_MIN, VT_V_MAX, 1, 1, theme.grid);
      drawZeroLines(ctx, MARGIN_LEFT, MARGIN_TOP, plotW, plotH,
        VT_T_MIN, VT_T_MAX, VT_V_MIN, VT_V_MAX, theme.axis);

      // Curvas pasadas (discontinuas)
      for (const rec of recordings) {
        const pts = rec.data.map(p => ({ x: p.t, y: p.v }));
        drawSeries(ctx, pts, MARGIN_LEFT, MARGIN_TOP, plotW, plotH,
          VT_T_MIN, VT_T_MAX, VT_V_MIN, VT_V_MAX, rec.color, true);
      }

      // Curva actual
      const pts = current.map(p => ({ x: p.t, y: p.v }));
      drawSeries(ctx, pts, MARGIN_LEFT, MARGIN_TOP, plotW, plotH,
        VT_T_MIN, VT_T_MAX, VT_V_MIN, VT_V_MAX, COLOR_CURRENT_VT, false);

      // ── Marcadores verticales A y B (cursor medidor) ───────────
      const xToPx = (x: number) =>
        MARGIN_LEFT + ((x - VT_T_MIN) / (VT_T_MAX - VT_T_MIN)) * plotW;
      const yToPx = (y: number) =>
        MARGIN_TOP + (1 - (y - VT_V_MIN) / (VT_V_MAX - VT_V_MIN)) * plotH;

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
        VT_T_MIN, VT_T_MAX, VT_V_MIN, VT_V_MAX, 2, 1,
        theme.label, "t (s)", "V (L)");
    },
    [current, recordings, markerLines],
  );

  // ── Canvas Flujo / Volumen ────────────────────────────────────────
  const drawFV = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const theme = themeColors();
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, w, h);

      const plotW = w - MARGIN_LEFT - MARGIN_RIGHT;
      const plotH = h - MARGIN_TOP - MARGIN_BOTTOM;

      drawGrid(ctx, MARGIN_LEFT, MARGIN_TOP, plotW, plotH,
        FV_V_MIN, FV_V_MAX, FV_F_MIN, FV_F_MAX, 1, 2, theme.grid);
      drawZeroLines(ctx, MARGIN_LEFT, MARGIN_TOP, plotW, plotH,
        FV_V_MIN, FV_V_MAX, FV_F_MIN, FV_F_MAX, theme.axis);

      for (const rec of recordings) {
        const pts = rec.data.map(p => ({ x: p.v, y: p.f }));
        drawSeries(ctx, pts, MARGIN_LEFT, MARGIN_TOP, plotW, plotH,
          FV_V_MIN, FV_V_MAX, FV_F_MIN, FV_F_MAX, rec.color, true);
      }

      const pts = current.map(p => ({ x: p.v, y: p.f }));
      drawSeries(ctx, pts, MARGIN_LEFT, MARGIN_TOP, plotW, plotH,
        FV_V_MIN, FV_V_MAX, FV_F_MIN, FV_F_MAX, COLOR_CURRENT_FV, false);

      // Líneas de referencia verticales: PEF/FVC arrastrables (sólidas);
      // FEF25/50/75 derivadas (discontinuas). Labels rotados 90° para
      // que nunca se solapen aunque las líneas estén juntas.
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
        if (r.x < FV_V_MIN || r.x > FV_V_MAX) continue;
        const px = MARGIN_LEFT + ((r.x - FV_V_MIN) / (FV_V_MAX - FV_V_MIN)) * plotW;
        const color = r.draggable ? COLOR_REF_DRAG : COLOR_REF_AUTO;
        ctx.strokeStyle = color;
        ctx.lineWidth = r.draggable ? 1.5 : 1;
        ctx.setLineDash(r.draggable ? [] : [3, 3]);
        ctx.beginPath();
        ctx.moveTo(px, MARGIN_TOP);
        ctx.lineTo(px, MARGIN_TOP + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
        // Label vertical: nunca se solapan aunque las líneas estén juntas
        ctx.save();
        ctx.translate(px + 3, MARGIN_TOP + 4);
        ctx.rotate(Math.PI / 2);
        ctx.fillStyle = color;
        ctx.font = `bold ${r.draggable ? 10 : 9}px monospace`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(`${r.label} ${r.x.toFixed(2)}`, 0, 0);
        ctx.restore();
      }
      ctx.restore();

      drawAxisLabels(ctx, MARGIN_LEFT, MARGIN_TOP, plotW, plotH,
        FV_V_MIN, FV_V_MAX, FV_F_MIN, FV_F_MAX, 1, 2,
        theme.label, "V (L)", "Flujo (L/s)");
    },
    [current, recordings, pef, fvc, fef25, fef50, fef75],
  );

  // ── Drag de PEF / FVC en el canvas Flujo/Volumen ─────────────────
  const dragRef = useRef<{ which: "pef" | "fvc" } | null>(null);
  const [cursor, setCursor] = useState("default");
  // ── Drag de marcadores A / B en el canvas Volumen/Tiempo ─────────
  const vtDragRef = useRef<{ which: "a" | "b" } | null>(null);
  const [vtCursor, setVtCursor] = useState("default");

  const xFromMouse = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = fvCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const plotW = fvWidth - MARGIN_LEFT - MARGIN_RIGHT;
    const v = FV_V_MIN + ((px - MARGIN_LEFT) / plotW) * (FV_V_MAX - FV_V_MIN);
    const pxPerL = plotW / (FV_V_MAX - FV_V_MIN);
    return { v, px, plotW, pxPerL };
  }, [fvWidth]);

  const handleFVDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const m = xFromMouse(e);
    if (!m) return;
    const grabL = REF_GRAB_PX / m.pxPerL;
    if (Math.abs(m.v - pef) < grabL) {
      dragRef.current = { which: "pef" };
      setCursor("ew-resize");
    } else if (Math.abs(m.v - fvc) < grabL) {
      dragRef.current = { which: "fvc" };
      setCursor("ew-resize");
    }
  }, [pef, fvc, xFromMouse]);

  const handleFVMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const m = xFromMouse(e);
    if (!m) return;
    if (dragRef.current) {
      const clamped = Math.max(FV_V_MIN, Math.min(FV_V_MAX, m.v));
      if (dragRef.current.which === "pef") {
        // PEF < FVC siempre
        onRefLinesChange({ pef: Math.min(clamped, fvc - 0.05), fvc });
      } else {
        onRefLinesChange({ pef, fvc: Math.max(clamped, pef + 0.05) });
      }
      return;
    }
    const grabL = REF_GRAB_PX / m.pxPerL;
    if (Math.abs(m.v - pef) < grabL || Math.abs(m.v - fvc) < grabL) {
      setCursor("ew-resize");
    } else {
      setCursor("default");
    }
  }, [pef, fvc, xFromMouse, onRefLinesChange]);

  const handleFVUp = useCallback(() => {
    dragRef.current = null;
    setCursor("default");
  }, []);

  // ── Handlers V/T para marcadores A/B ──────────────────────────────
  const tFromMouse = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = vtCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const plotW = vtWidth - MARGIN_LEFT - MARGIN_RIGHT;
    const t = VT_T_MIN + ((px - MARGIN_LEFT) / plotW) * (VT_T_MAX - VT_T_MIN);
    const pxPerS = plotW / (VT_T_MAX - VT_T_MIN);
    return { t, pxPerS };
  }, [vtWidth]);

  const handleVTDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const m = tFromMouse(e);
    if (!m) return;
    const grabS = REF_GRAB_PX / m.pxPerS;
    // Si A y B se solapan, preferir el que esté más cerca
    const dA = Math.abs(m.t - markerLines.a);
    const dB = Math.abs(m.t - markerLines.b);
    if (dA < grabS && dA <= dB) {
      vtDragRef.current = { which: "a" };
      setVtCursor("ew-resize");
    } else if (dB < grabS) {
      vtDragRef.current = { which: "b" };
      setVtCursor("ew-resize");
    }
  }, [markerLines, tFromMouse]);

  const handleVTMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const m = tFromMouse(e);
    if (!m) return;
    if (vtDragRef.current) {
      const clamped = Math.max(VT_T_MIN, Math.min(VT_T_MAX, m.t));
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
  }, [markerLines, tFromMouse, onMarkerLinesChange]);

  const handleVTUp = useCallback(() => {
    vtDragRef.current = null;
    setVtCursor("default");
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: height ?? "100%", minHeight }}
      className="flex gap-2"
    >
      {containerWidth > 0 && (
        <>
          <ChartPanel
            width={vtWidth}
            height={effectiveHeight}
            draw={drawVT}
            onMouseDown={handleVTDown}
            onMouseMove={handleVTMove}
            onMouseUp={handleVTUp}
            cursor={vtCursor}
            canvasRef={vtCanvasRef}
          />
          <ChartPanel
            width={fvWidth}
            height={effectiveHeight}
            draw={drawFV}
            onMouseDown={handleFVDown}
            onMouseMove={handleFVMove}
            onMouseUp={handleFVUp}
            cursor={cursor}
            canvasRef={fvCanvasRef}
          />
        </>
      )}
    </div>
  );
}
