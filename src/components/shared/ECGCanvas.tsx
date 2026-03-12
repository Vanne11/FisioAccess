import { useRef, useEffect, useCallback, useState } from "react";
import type { ECGMarker, MarkerToolType, QRSComplex } from "@/lib/markers";
import { MARKER_COLORS, QRS_COLOR } from "@/lib/markers";
import type { RPeak } from "@/lib/peaks";

export interface ECGDataPoint {
  timestamp_ms: number;
  value: number;
}

interface ECGCanvasProps {
  data: ECGDataPoint[];
  sweepSpeed: number;
  sensitivity: number;
  frozen: boolean;
  zoom: number;
  markers: ECGMarker[];
  qrsComplexes: QRSComplex[];
  rPeaks: RPeak[];
  activeTool: MarkerToolType | null;
  onCanvasClick?: (timestamp_ms: number) => void;
  height?: number;
  className?: string;
}

const PX_PER_MM = 3;
const MARGIN_LEFT = 34;
const SCROLLBAR_H = 14;

const COLOR_SMALL_GRID = "rgba(220, 38, 38, 0.12)";
const COLOR_LARGE_GRID = "rgba(220, 38, 38, 0.30)";
const COLOR_FROZEN_BADGE = "rgba(239, 68, 68, 0.7)";
const COLOR_RPEAK_DOT = "rgba(239, 68, 68, 0.6)";

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
  sensitivity = 10,
  frozen = false,
  zoom = 1,
  markers,
  qrsComplexes,
  rPeaks,
  activeTool,
  onCanvasClick,
  height = 320,
  className,
}: ECGCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  const [scrollOffsetMs, setScrollOffsetMs] = useState(0);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartOffsetRef = useRef(0);
  // Para distinguir click de drag
  const didDragRef = useRef(false);

  useEffect(() => {
    if (!frozen) setScrollOffsetMs(0);
  }, [frozen]);

  const getVisibleMs = useCallback(
    (canvasWidth: number) => {
      const pxPerMs = (PX_PER_MM * sweepSpeed * zoom) / 1000;
      return (canvasWidth - MARGIN_LEFT) / pxPerMs;
    },
    [sweepSpeed, zoom],
  );

  const getTotalMs = useCallback(() => {
    if (data.length < 2) return 0;
    return data[data.length - 1].timestamp_ms - data[0].timestamp_ms;
  }, [data]);

  // --- Refs para mapeo de coordenadas (usados en click handler) ---
  const viewRef = useRef({ startTs: 0, pxPerMs: 1 });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const theme = getThemeColors();

    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const totalH = container.clientHeight || height;
    const chartH = frozen ? totalH - SCROLLBAR_H : totalH;

    canvas.width = w * dpr;
    canvas.height = totalH * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${totalH}px`;
    ctx.scale(dpr, dpr);

    const smallPx = PX_PER_MM;
    const largePx = PX_PER_MM * 5;

    // Fondo
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, totalH);

    // Cuadricula pequena
    ctx.strokeStyle = COLOR_SMALL_GRID;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = 0; x <= w; x += smallPx) { ctx.moveTo(x, 0); ctx.lineTo(x, chartH); }
    for (let y = 0; y <= chartH; y += smallPx) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();

    // Cuadricula grande
    ctx.strokeStyle = COLOR_LARGE_GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= w; x += largePx) { ctx.moveTo(x, 0); ctx.lineTo(x, chartH); }
    for (let y = 0; y <= chartH; y += largePx) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();

    if (data.length < 2) {
      ctx.fillStyle = theme.label;
      ctx.font = "9px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`${sweepSpeed} mm/s | sens ${sensitivity}`, MARGIN_LEFT, chartH - 6);
      return;
    }

    // Escalas de tiempo
    const pxPerMs = (PX_PER_MM * sweepSpeed * zoom) / 1000;
    const visibleMs = (w - MARGIN_LEFT) / pxPerMs;

    const offset = frozen ? scrollOffsetMs : 0;
    const lastTs = data[data.length - 1].timestamp_ms;
    const endTs = lastTs - offset;
    const startTs = endTs - visibleMs;

    // Guardar para click handler
    viewRef.current = { startTs, pxPerMs };

    // Busqueda binaria
    let lo = 0;
    let hi = data.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (data[mid].timestamp_ms < startTs) lo = mid + 1; else hi = mid; }
    const startIdx = Math.max(0, lo - 1);

    // Auto-escala vertical
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let i = startIdx; i < data.length; i++) {
      const pt = data[i];
      if (pt.timestamp_ms > endTs) break;
      if (pt.timestamp_ms < startTs) continue;
      if (pt.value < minVal) minVal = pt.value;
      if (pt.value > maxVal) maxVal = pt.value;
    }
    const range = maxVal - minVal || 1;
    const center = (maxVal + minVal) / 2;
    const fillRatio = Math.min(0.95, (sensitivity / 10) * 0.45 + 0.30);
    const pxPerUnit = (chartH * fillRatio) / range;
    const valueToY = (val: number) => chartH / 2 - (val - center) * pxPerUnit;
    const tsToX = (ts: number) => MARGIN_LEFT + (ts - startTs) * pxPerMs;

    // Etiquetas eje Y
    ctx.fillStyle = theme.label;
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const labelStep = range / 6;
    for (let i = -3; i <= 3; i++) {
      const val = center + i * labelStep;
      const y = valueToY(val);
      if (y < 5 || y > chartH - 5) continue;
      ctx.fillText(val.toFixed(0), 28, y);
    }

    // Etiqueta escala
    ctx.fillStyle = theme.label;
    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    const zl = zoom !== 1 ? ` | x${zoom.toFixed(1)}` : "";
    ctx.fillText(`${sweepSpeed} mm/s | sens ${sensitivity}${zl}`, MARGIN_LEFT, chartH - 6);

    // --- Dibujar marcadores de intervalo (fondo) ---
    for (const m of markers) {
      if (m.kind !== "interval") continue;
      const x1 = tsToX(m.startMs);
      const x2 = tsToX(m.endMs);
      if (x2 < MARGIN_LEFT || x1 > w) continue;
      ctx.fillStyle = MARKER_COLORS[m.type] + "15";
      ctx.fillRect(Math.max(MARGIN_LEFT, x1), 0, Math.min(w, x2) - Math.max(MARGIN_LEFT, x1), chartH);
    }

    // --- Trazo ECG ---
    ctx.save();
    ctx.beginPath();
    ctx.rect(MARGIN_LEFT, 0, w - MARGIN_LEFT, chartH);
    ctx.clip();

    ctx.strokeStyle = theme.trace;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();

    let started = false;
    for (let i = startIdx; i < data.length; i++) {
      const pt = data[i];
      if (pt.timestamp_ms > endTs) break;
      if (pt.timestamp_ms < startTs) continue;
      const x = tsToX(pt.timestamp_ms);
      const y = valueToY(pt.value);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Glow
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.1;
    ctx.beginPath();
    started = false;
    for (let i = startIdx; i < data.length; i++) {
      const pt = data[i];
      if (pt.timestamp_ms > endTs) break;
      if (pt.timestamp_ms < startTs) continue;
      const x = tsToX(pt.timestamp_ms);
      const y = valueToY(pt.value);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
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

      // Linea vertical
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, chartH);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Label
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

      // Lineas de borde
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

      // Label
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

      // Zona sombreada
      ctx.fillStyle = QRS_COLOR + "12";
      ctx.fillRect(Math.max(MARGIN_LEFT, xq), 0, Math.min(w, xs) - Math.max(MARGIN_LEFT, xq), chartH);

      // Bracket superior
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

      // Label
      const mx = (xq + xs) / 2;
      ctx.fillStyle = QRS_COLOR;
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`QRS ${qrs.durationMs.toFixed(0)}ms`, mx, bracketY - 3);
    }

    ctx.restore();

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
  }, [data, sweepSpeed, sensitivity, frozen, zoom, height, scrollOffsetMs, markers, qrsComplexes, rPeaks, getTotalMs]);

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

  // --- Mouse handlers: drag para scroll + click para marcadores ---
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
      const pxPerMs = (PX_PER_MM * sweepSpeed * zoom) / 1000;
      const dtMs = (e.clientX - dragStartXRef.current) / pxPerMs;
      const visibleMs = getVisibleMs(container.clientWidth);
      const totalMs = getTotalMs();
      const maxOffset = Math.max(0, totalMs - visibleMs);
      setScrollOffsetMs(Math.max(0, Math.min(maxOffset, dragStartOffsetRef.current + dtMs)));
    },
    [frozen, data, sweepSpeed, zoom, getVisibleMs, getTotalMs],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const wasDragging = isDraggingRef.current;
      isDraggingRef.current = false;

      // Si no hubo drag significativo y hay herramienta activa, es un click para marcar
      if (wasDragging && !didDragRef.current && activeTool && onCanvasClick && frozen) {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const { startTs, pxPerMs } = viewRef.current;
        const ts = startTs + (px - MARGIN_LEFT) / pxPerMs;
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
      style={{ width: "100%", height: height ? height : "100%", minHeight: 200, cursor: cursorStyle }}
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
