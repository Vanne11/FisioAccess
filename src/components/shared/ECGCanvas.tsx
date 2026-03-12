import { useRef, useEffect, useCallback, useState } from "react";
import type { ECGMarker, MarkerToolType, QRSComplex } from "@/lib/markers";
import { MARKER_COLORS, QRS_COLOR } from "@/lib/markers";
import type { RPeak } from "@/lib/peaks";
import { createECGScale, type ECGScale } from "@/utils/ecgScale";
import type { CalibrationConfig } from "@/utils/signalCalibrator";

export interface ECGDataPoint {
  timestamp_ms: number;
  value: number;
}

interface ECGCanvasProps {
  data: ECGDataPoint[];
  sweepSpeed: number;
  frozen: boolean;
  zoom: number;
  markers: ECGMarker[];
  qrsComplexes: QRSComplex[];
  rPeaks: RPeak[];
  activeTool: MarkerToolType | null;
  onCanvasClick?: (timestamp_ms: number) => void;
  calibration: CalibrationConfig;
  sampleRate: number;
  className?: string;
}

const MARGIN_LEFT = 40;
const SCROLLBAR_H = 14;

const COLOR_SMALL_GRID = "rgba(200, 50, 50, 0.12)";
const COLOR_LARGE_GRID = "rgba(200, 50, 50, 0.25)";
const COLOR_FROZEN_BADGE = "rgba(239, 68, 68, 0.7)";
const COLOR_RPEAK_DOT = "rgba(239, 68, 68, 0.6)";

/** Pick a "nice" grid interval for the Y axis given a visible range */
function niceGridInterval(range: number): { small: number; large: number } {
  if (range <= 0) return { small: 0.1, large: 0.5 };
  const targetDivisions = 20;
  const rawInterval = range / targetDivisions;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
  const normalized = rawInterval / magnitude;
  let nice: number;
  if (normalized <= 1) nice = 1;
  else if (normalized <= 2) nice = 2;
  else if (normalized <= 5) nice = 5;
  else nice = 10;
  const small = nice * magnitude;
  return { small, large: small * 5 };
}

function getThemeColors() {
  const s = getComputedStyle(document.documentElement);
  const get = (v: string, fb: string) => s.getPropertyValue(v).trim() || fb;
  return {
    bg: get("--color-surface-950", "#020617"),
    label: get("--color-secondary", "#64748b"),
    trace: "#000000",
    scrollBg: get("--color-surface-800", "#1e293b"),
    scrollFg: get("--color-surface-600", "#475569"),
  };
}

export function ECGCanvas({
  data,
  sweepSpeed = 25,
  frozen = false,
  zoom = 1,
  markers,
  qrsComplexes,
  rPeaks,
  activeTool,
  onCanvasClick,
  calibration,
  sampleRate,
  className,
}: ECGCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  const [scrollOffsetMs, setScrollOffsetMs] = useState(0);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartOffsetRef = useRef(0);
  const didDragRef = useRef(false);

  useEffect(() => {
    if (!frozen) setScrollOffsetMs(0);
  }, [frozen]);

  const getVisibleMs = useCallback(
    (canvasWidth: number) => {
      const scale = createECGScale({
        sweepSpeed, zoom,
        canvasWidth, canvasHeight: 100, marginLeft: MARGIN_LEFT,
      });
      return scale.visibleDurationMs;
    },
    [sweepSpeed, zoom],
  );

  const getTotalMs = useCallback(() => {
    if (data.length < 2) return 0;
    return data[data.length - 1].timestamp_ms - data[0].timestamp_ms;
  }, [data]);

  // Ref para click handler (mapeo de coordenadas)
  const scaleRef = useRef<ECGScale | null>(null);
  const viewStartRef = useRef(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const theme = getThemeColors();

    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const totalH = container.clientHeight || 320;
    const chartH = frozen ? totalH - SCROLLBAR_H : totalH;

    canvas.width = w * dpr;
    canvas.height = totalH * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${totalH}px`;
    ctx.scale(dpr, dpr);

    // --- Crear escala (solo horizontal) ---
    const scale = createECGScale({
      sweepSpeed, zoom,
      canvasWidth: w, canvasHeight: chartH, marginLeft: MARGIN_LEFT,
    });
    scaleRef.current = scale;

    // --- Fondo ---
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, totalH);

    // --- Determinar rango temporal visible ---
    const offset = frozen ? scrollOffsetMs : 0;
    const lastTs = data.length >= 2 ? data[data.length - 1].timestamp_ms : 0;
    const endTs = lastTs - offset;
    const startTs = endTs - scale.visibleDurationMs;
    viewStartRef.current = startTs;

    // --- Busqueda binaria del rango visible ---
    let lo = 0;
    let hi = data.length - 1;
    if (data.length >= 2) {
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (data[mid].timestamp_ms < startTs) lo = mid + 1;
        else hi = mid;
      }
    }
    const startIdx = Math.max(0, lo - 1);

    // --- Auto-escala Y: min/max de datos visibles ---
    let yMin = Infinity;
    let yMax = -Infinity;
    if (data.length >= 2) {
      for (let i = startIdx; i < data.length; i++) {
        const pt = data[i];
        if (pt.timestamp_ms > endTs) break;
        if (pt.timestamp_ms < startTs) continue;
        if (pt.value < yMin) yMin = pt.value;
        if (pt.value > yMax) yMax = pt.value;
      }
    }
    if (!isFinite(yMin) || !isFinite(yMax) || yMin === yMax) {
      // Fallback: centrar en 0 con rango ±1
      yMin = -1;
      yMax = 1;
    }
    // Margen 10% arriba y abajo → señal ocupa ~80%
    const yRange = yMax - yMin;
    const yMargin = yRange * 0.1;
    yMin -= yMargin;
    yMax += yMargin;

    const valueToY = (v: number) => chartH - ((v - yMin) / (yMax - yMin)) * chartH;

    // --- Cuadricula Y: intervalos dinámicos según rango visible ---
    const { small: smallMv, large: largeMv } = niceGridInterval(yMax - yMin);

    // Lineas horizontales (voltaje)
    if (smallMv > 0) {
      ctx.strokeStyle = COLOR_SMALL_GRID;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      const firstSmallMv = Math.ceil(yMin / smallMv) * smallMv;
      for (let mv = firstSmallMv; mv <= yMax; mv += smallMv) {
        const y = valueToY(mv);
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();

      ctx.strokeStyle = COLOR_LARGE_GRID;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const firstLargeMv = Math.ceil(yMin / largeMv) * largeMv;
      for (let mv = firstLargeMv; mv <= yMax; mv += largeMv) {
        const y = valueToY(mv);
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
    }

    // --- Cuadricula X: lineas verticales de tiempo ---
    const { smallMs, largeMs } = scale.getGridTimeInterval();

    ctx.strokeStyle = COLOR_SMALL_GRID;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    if (data.length >= 2) {
      const firstSmallT = Math.ceil(startTs / smallMs) * smallMs;
      for (let t = firstSmallT; t <= endTs; t += smallMs) {
        const x = scale.timeToX(t, startTs);
        if (x < MARGIN_LEFT) continue;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, chartH);
      }
    } else {
      for (let x = MARGIN_LEFT; x <= w; x += scale.gridSmallPx) {
        ctx.moveTo(x, 0); ctx.lineTo(x, chartH);
      }
    }
    ctx.stroke();

    ctx.strokeStyle = COLOR_LARGE_GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (data.length >= 2) {
      const firstLargeT = Math.ceil(startTs / largeMs) * largeMs;
      for (let t = firstLargeT; t <= endTs; t += largeMs) {
        const x = scale.timeToX(t, startTs);
        if (x < MARGIN_LEFT) continue;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, chartH);
      }
    } else {
      for (let x = MARGIN_LEFT; x <= w; x += scale.gridLargePx) {
        ctx.moveTo(x, 0); ctx.lineTo(x, chartH);
      }
    }
    ctx.stroke();

    // --- Etiquetas eje Y (valores reales) ---
    if (largeMv > 0) {
      ctx.fillStyle = theme.label;
      ctx.font = "10px monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const firstLargeMv = Math.ceil(yMin / largeMv) * largeMv;
      for (let mv = firstLargeMv; mv <= yMax; mv += largeMv) {
        const y = valueToY(mv);
        if (y < 8 || y > chartH - 8) continue;
        const label = Math.abs(mv) < 0.001 ? "0" : mv.toFixed(2);
        ctx.fillText(label, MARGIN_LEFT - 4, y);
      }
    }

    // --- Etiqueta escala inferior ---
    ctx.fillStyle = theme.label;
    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    const zl = zoom !== 1 ? ` | x${zoom.toFixed(1)}` : "";
    const fsLabel = sampleRate > 0 ? ` | ${sampleRate.toFixed(0)}Hz` : "";
    ctx.fillText(`${sweepSpeed}mm/s${zl}${fsLabel}`, MARGIN_LEFT, chartH - 6);

    // --- Barra de referencia 1s en esquina inferior derecha ---
    const bar1sW = scale.pxPerMs * 1000;
    if (bar1sW > 10 && bar1sW < w * 0.5) {
      const barY = chartH - 14;
      const barEndX = w - 10;
      const barStartX = barEndX - bar1sW;
      if (barStartX > MARGIN_LEFT + 100) {
        ctx.strokeStyle = theme.label;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(barStartX, barY);
        ctx.lineTo(barEndX, barY);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(barStartX, barY - 3);
        ctx.lineTo(barStartX, barY + 3);
        ctx.moveTo(barEndX, barY - 3);
        ctx.lineTo(barEndX, barY + 3);
        ctx.stroke();
        ctx.fillStyle = theme.label;
        ctx.font = "8px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText("1s", (barStartX + barEndX) / 2, barY - 2);
      }
    }

    if (data.length < 2) return;

    const tsToX = (ts: number) => scale.timeToX(ts, startTs);

    // --- Marcadores de intervalo (fondo) ---
    for (const m of markers) {
      if (m.kind !== "interval") continue;
      const x1 = tsToX(m.startMs);
      const x2 = tsToX(m.endMs);
      if (x2 < MARGIN_LEFT || x1 > w) continue;
      ctx.fillStyle = MARKER_COLORS[m.type] + "15";
      ctx.fillRect(Math.max(MARGIN_LEFT, x1), 0, Math.min(w, x2) - Math.max(MARGIN_LEFT, x1), chartH);
    }

    // --- Detectar gaps temporales (pausas) ---
    const expectedDt = sampleRate > 10 ? 1000 / sampleRate : 20;
    const gapThreshold = Math.max(500, expectedDt * 10);
    const gaps: { x1: number; x2: number; durationMs: number }[] = [];
    {
      let prevTs = -1;
      for (let i = startIdx; i < data.length; i++) {
        const pt = data[i];
        if (pt.timestamp_ms > endTs) break;
        if (pt.timestamp_ms < startTs) { prevTs = pt.timestamp_ms; continue; }
        if (prevTs >= 0 && pt.timestamp_ms - prevTs > gapThreshold) {
          gaps.push({
            x1: tsToX(prevTs),
            x2: tsToX(pt.timestamp_ms),
            durationMs: pt.timestamp_ms - prevTs,
          });
        }
        prevTs = pt.timestamp_ms;
      }
    }

    // --- Trazo ECG (con clip) ---
    ctx.save();
    ctx.beginPath();
    ctx.rect(MARGIN_LEFT, 0, w - MARGIN_LEFT, chartH);
    ctx.clip();

    // Dibujar indicadores de gap (fondo)
    for (const gap of gaps) {
      const gx1 = Math.max(MARGIN_LEFT, gap.x1);
      const gx2 = Math.min(w, gap.x2);
      ctx.fillStyle = "rgba(100, 116, 139, 0.08)";
      ctx.fillRect(gx1, 0, gx2 - gx1, chartH);
      // Lineas punteadas en los bordes del gap
      ctx.strokeStyle = "rgba(100, 116, 139, 0.3)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(gx1, 0); ctx.lineTo(gx1, chartH);
      ctx.moveTo(gx2, 0); ctx.lineTo(gx2, chartH);
      ctx.stroke();
      ctx.setLineDash([]);
      // Label de duración de la pausa
      const mx = (gx1 + gx2) / 2;
      if (gx2 - gx1 > 30) {
        const durLabel = gap.durationMs >= 60000
          ? `${(gap.durationMs / 60000).toFixed(1)}m`
          : gap.durationMs >= 1000
            ? `${(gap.durationMs / 1000).toFixed(1)}s`
            : `${gap.durationMs.toFixed(0)}ms`;
        ctx.fillStyle = "rgba(100, 116, 139, 0.6)";
        ctx.font = "9px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`⏸ ${durLabel}`, mx, chartH / 2);
      }
    }

    ctx.strokeStyle = theme.trace;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();

    let started = false;
    let prevTsTrace = -1;
    for (let i = startIdx; i < data.length; i++) {
      const pt = data[i];
      if (pt.timestamp_ms > endTs) break;
      if (pt.timestamp_ms < startTs) { prevTsTrace = pt.timestamp_ms; continue; }
      const x = tsToX(pt.timestamp_ms);
      const y = valueToY(pt.value);
      const isGap = prevTsTrace >= 0 && pt.timestamp_ms - prevTsTrace > gapThreshold;
      if (!started || isGap) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
      prevTsTrace = pt.timestamp_ms;
    }
    ctx.stroke();

    // Glow
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.1;
    ctx.beginPath();
    started = false;
    prevTsTrace = -1;
    for (let i = startIdx; i < data.length; i++) {
      const pt = data[i];
      if (pt.timestamp_ms > endTs) break;
      if (pt.timestamp_ms < startTs) { prevTsTrace = pt.timestamp_ms; continue; }
      const x = tsToX(pt.timestamp_ms);
      const y = valueToY(pt.value);
      const isGap = prevTsTrace >= 0 && pt.timestamp_ms - prevTsTrace > gapThreshold;
      if (!started || isGap) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
      prevTsTrace = pt.timestamp_ms;
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // --- R-peak dots ---
    for (const pk of rPeaks) {
      if (pk.timestamp_ms < startTs || pk.timestamp_ms > endTs) continue;
      const x = tsToX(pk.timestamp_ms);
      const y = valueToY(pk.value);
      ctx.fillStyle = COLOR_RPEAK_DOT;
      ctx.beginPath();
      ctx.arc(x, y - 6, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- Marcadores puntuales ---
    for (const m of markers) {
      if (m.kind !== "point") continue;
      if (m.timestamp_ms < startTs || m.timestamp_ms > endTs) continue;
      const x = tsToX(m.timestamp_ms);
      const color = MARKER_COLORS[m.type];

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, chartH);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = color;
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "center";
      ctx.fillText(m.type, x, 14);
    }

    // --- Marcadores de intervalo (lineas + label) ---
    for (const m of markers) {
      if (m.kind !== "interval") continue;
      const x1 = tsToX(m.startMs);
      const x2 = tsToX(m.endMs);
      if (x2 < MARGIN_LEFT || x1 > w) continue;
      const color = MARKER_COLORS[m.type];
      const durMs = m.endMs - m.startMs;

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.7;
      for (const bx of [x1, x2]) {
        ctx.beginPath();
        ctx.setLineDash([3, 3]);
        ctx.moveTo(bx, 0);
        ctx.lineTo(bx, chartH);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      const mx = (x1 + x2) / 2;
      ctx.fillStyle = color;
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${m.type} ${durMs.toFixed(0)}ms`, mx, chartH - 18);
    }

    // --- Complejos QRS ---
    for (let qi = 0; qi < qrsComplexes.length; qi++) {
      const qrs = qrsComplexes[qi];
      const xq = tsToX(qrs.qMs);
      const xs = tsToX(qrs.sMs);
      if (xs < MARGIN_LEFT || xq > w) continue;

      ctx.fillStyle = QRS_COLOR + "12";
      ctx.fillRect(Math.max(MARGIN_LEFT, xq), 0, Math.min(w, xs) - Math.max(MARGIN_LEFT, xq), chartH);

      const bracketY = 28;
      ctx.strokeStyle = QRS_COLOR;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(xq, bracketY + 6);
      ctx.lineTo(xq, bracketY);
      ctx.lineTo(xs, bracketY);
      ctx.lineTo(xs, bracketY + 6);
      ctx.stroke();
      ctx.globalAlpha = 1;

      const mx = (xq + xs) / 2;
      ctx.fillStyle = QRS_COLOR;
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`QRS ${qrs.durationMs.toFixed(0)}ms`, mx, bracketY - 3);
    }

    ctx.restore();

    // --- Etiquetas eje X (timestamps alineados) ---
    if (data.length >= 2) {
      ctx.fillStyle = theme.label;
      ctx.font = "8px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const { largeMs: timeLargeMs } = scale.getGridTimeInterval();
      const labelInterval = timeLargeMs * 5;
      const firstLabel = Math.ceil(startTs / labelInterval) * labelInterval;
      for (let t = firstLabel; t <= endTs; t += labelInterval) {
        const x = tsToX(t);
        if (x < MARGIN_LEFT + 10 || x > w - 10) continue;
        const relSec = (t - data[0].timestamp_ms) / 1000;
        ctx.fillText(`${relSec.toFixed(1)}s`, x, chartH - 22);
      }
    }

    // --- Frozen badge + scrollbar ---
    if (frozen) {
      ctx.fillStyle = COLOR_FROZEN_BADGE;
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "right";
      ctx.fillText("FROZEN", w - 8, 14);

      ctx.fillStyle = theme.label;
      ctx.font = "9px monospace";
      ctx.textAlign = "right";
      ctx.fillText(`-${(offset / 1000).toFixed(1)}s`, w - 8, 26);

      const totalMs = getTotalMs();
      if (totalMs > 0) {
        const barY = chartH + 2;
        const barW = w - MARGIN_LEFT;
        const barX = MARGIN_LEFT;
        ctx.fillStyle = theme.scrollBg;
        ctx.fillRect(barX, barY, barW, SCROLLBAR_H - 4);
        const visibleMs = scale.visibleDurationMs;
        const thumbRatio = Math.min(1, visibleMs / totalMs);
        const thumbW = Math.max(20, barW * thumbRatio);
        const scrollableRange = totalMs - visibleMs;
        const thumbPos = scrollableRange > 0 ? (1 - offset / scrollableRange) * (barW - thumbW) : 0;
        ctx.fillStyle = theme.scrollFg;
        ctx.beginPath();
        ctx.roundRect(barX + thumbPos, barY, thumbW, SCROLLBAR_H - 4, (SCROLLBAR_H - 4) / 2);
        ctx.fill();
      }
    }
  }, [data, sweepSpeed, frozen, zoom, scrollOffsetMs, markers, qrsComplexes, rPeaks, calibration, sampleRate, getTotalMs]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(draw);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [draw]);

  // --- Scroll con rueda ---
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!frozen || data.length < 2) return;
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const visibleMs = getVisibleMs(container.clientWidth);
      const totalMs = getTotalMs();
      const maxOffset = Math.max(0, totalMs - visibleMs);
      const step = visibleMs * 0.2;
      const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      const direction = delta > 0 ? 1 : -1;
      setScrollOffsetMs((prev) => Math.max(0, Math.min(maxOffset, prev + direction * step)));
    },
    [frozen, data, getVisibleMs, getTotalMs],
  );

  // --- Mouse handlers ---
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!frozen) return;
      isDraggingRef.current = true;
      didDragRef.current = false;
      dragStartXRef.current = e.clientX;
      dragStartOffsetRef.current = scrollOffsetMs;
      e.preventDefault();
    },
    [frozen, scrollOffsetMs],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDraggingRef.current || !frozen || data.length < 2) return;
      const dx = Math.abs(e.clientX - dragStartXRef.current);
      if (dx > 3) didDragRef.current = true;
      const container = containerRef.current;
      if (!container) return;
      const s = scaleRef.current;
      if (!s) return;
      const dtMs = (e.clientX - dragStartXRef.current) / s.pxPerMs;
      const visibleMs = s.visibleDurationMs;
      const totalMs = getTotalMs();
      const maxOffset = Math.max(0, totalMs - visibleMs);
      setScrollOffsetMs(Math.max(0, Math.min(maxOffset, dragStartOffsetRef.current + dtMs)));
    },
    [frozen, data, getTotalMs],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const wasDragging = isDraggingRef.current;
      isDraggingRef.current = false;

      if (wasDragging && !didDragRef.current && activeTool && onCanvasClick && frozen) {
        const container = containerRef.current;
        if (!container) return;
        const s = scaleRef.current;
        if (!s) return;
        const rect = container.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const ts = s.xToTime(px, viewStartRef.current);
        if (ts > 0) onCanvasClick(ts);
      }
    },
    [activeTool, onCanvasClick, frozen],
  );

  const handleMouseLeave = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const cursorStyle = activeTool && frozen ? "crosshair" : frozen ? "grab" : "default";

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height: "100%", minHeight: 200, cursor: cursorStyle }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
}
