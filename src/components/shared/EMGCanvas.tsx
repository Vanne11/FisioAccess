import { useRef, useEffect, useCallback, useState } from "react";

export interface EMGDataPoint {
  timestamp_ms: number;
  value: number;
}

export type EMGPhaseType = "reposo" | "leve" | "maxima" | "relajacion";

export interface EMGPhaseMarker {
  id: string;
  type: EMGPhaseType;
  startMs: number;
  endMs: number | null; // null = en curso
}

export const EMG_PHASE_CONFIG: Record<EMGPhaseType, { label: string; color: string; bg: string }> = {
  reposo:      { label: "Reposo",             color: "#38bdf8", bg: "rgba(56, 189, 248, 0.12)" },
  leve:        { label: "Contracción leve",   color: "#fbbf24", bg: "rgba(251, 191, 36, 0.12)" },
  maxima:      { label: "Contracción máxima", color: "#f87171", bg: "rgba(248, 113, 113, 0.12)" },
  relajacion:  { label: "Relajación",         color: "#4ade80", bg: "rgba(74, 222, 128, 0.12)" },
};

interface EMGCanvasProps {
  data: EMGDataPoint[];
  frozen: boolean;
  markers?: EMGPhaseMarker[];
  activePhase?: EMGPhaseType | null;
  pendingStartMs?: number | null;
  onCanvasClick?: (timestamp_ms: number) => void;
  className?: string;
}

const MARGIN_LEFT = 52;
const MARGIN_BOTTOM = 24;
const SCROLLBAR_H = 14;

const COLOR_GRID_SMALL = "rgba(245, 158, 11, 0.10)";
const COLOR_GRID_LARGE = "rgba(245, 158, 11, 0.22)";
const COLOR_TRACE = "rgba(245, 158, 11, 1)";
const COLOR_GLOW = "rgba(245, 158, 11, 0.12)";
const COLOR_ZERO = "rgba(255, 255, 255, 0.15)";

function getThemeColors() {
  const s = getComputedStyle(document.documentElement);
  const get = (v: string, fb: string) => s.getPropertyValue(v).trim() || fb;
  return {
    bg: get("--color-surface-950", "#020617"),
    label: get("--color-secondary", "#64748b"),
    scrollBg: get("--color-surface-800", "#1e293b"),
    scrollFg: get("--color-surface-600", "#475569"),
  };
}

/** Intervalo "bonito" para grid */
function niceInterval(range: number, targetDivs: number): { small: number; large: number } {
  if (range <= 0) return { small: 0.1, large: 0.5 };
  const raw = range / targetDivs;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let nice: number;
  if (norm <= 1) nice = 1;
  else if (norm <= 2) nice = 2;
  else if (norm <= 5) nice = 5;
  else nice = 10;
  const small = nice * mag;
  return { small, large: small * 5 };
}

/** Decimales para un step */
function decFor(step: number): number {
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  if (step >= 0.01) return 2;
  return 3;
}

/** Formatea tiempo relativo */
function fmtTime(sec: number): string {
  if (sec >= 60) return `${(sec / 60).toFixed(1)}m`;
  if (sec >= 10) return `${sec.toFixed(0)}s`;
  if (sec >= 1) return `${sec.toFixed(1)}s`;
  return `${(sec * 1000).toFixed(0)}ms`;
}

export function EMGCanvas({ data, frozen, markers = [], activePhase, pendingStartMs, onCanvasClick, className }: EMGCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  // Scroll/drag en frozen
  const [scrollMs, setScrollMs] = useState(0);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartOff = useRef(0);
  const pxPerMsRef = useRef(0.1);
  const viewStartRef = useRef(0);
  const didDragRef = useRef(false);

  useEffect(() => {
    if (!frozen) setScrollMs(0);
  }, [frozen]);

  const totalMs = useCallback(() => {
    if (data.length < 2) return 0;
    return data[data.length - 1].timestamp_ms - data[0].timestamp_ms;
  }, [data]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const theme = getThemeColors();
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const fullH = container.clientHeight || 300;
    const chartH = frozen ? fullH - SCROLLBAR_H : fullH;
    const plotH = chartH - MARGIN_BOTTOM;

    canvas.width = w * dpr;
    canvas.height = fullH * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${fullH}px`;
    ctx.scale(dpr, dpr);

    // Fondo
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, fullH);

    const plotW = w - MARGIN_LEFT;

    // Rango temporal visible: últimos N ms
    // A 100Hz con plotW ~800px queremos ~5s visibles = 5000ms
    const desiredVisibleMs = Math.max(2000, plotW * 6);
    const offset = frozen ? scrollMs : 0;
    const lastTs = data.length >= 2 ? data[data.length - 1].timestamp_ms : 0;
    const endTs = lastTs - offset;
    const startTs = endTs - desiredVisibleMs;
    const pxPerMs = plotW / desiredVisibleMs;
    pxPerMsRef.current = pxPerMs;
    viewStartRef.current = startTs;

    const tsToX = (ts: number) => MARGIN_LEFT + (ts - startTs) * pxPerMs;

    // Buscar rango visible (binaria)
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

    // Auto-escala Y
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
      yMin = -10;
      yMax = 10;
    }
    const yRange = yMax - yMin;
    const yPad = yRange * 0.12;
    yMin -= yPad;
    yMax += yPad;

    const valueToY = (v: number) => (1 - (v - yMin) / (yMax - yMin)) * plotH;

    // --- Grid Y ---
    const { small: ySmall, large: yLarge } = niceInterval(yMax - yMin, 16);
    const yDec = decFor(yLarge);

    if (ySmall > 0) {
      ctx.strokeStyle = COLOR_GRID_SMALL;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      const first = Math.ceil(yMin / ySmall) * ySmall;
      for (let v = first; v <= yMax; v += ySmall) {
        const y = valueToY(v);
        ctx.moveTo(MARGIN_LEFT, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();

      ctx.strokeStyle = COLOR_GRID_LARGE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const firstL = Math.ceil(yMin / yLarge) * yLarge;
      for (let v = firstL; v <= yMax; v += yLarge) {
        const y = valueToY(v);
        ctx.moveTo(MARGIN_LEFT, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
    }

    // Labels Y
    if (yLarge > 0) {
      ctx.fillStyle = theme.label;
      ctx.font = "10px monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const firstL = Math.ceil(yMin / yLarge) * yLarge;
      for (let v = firstL; v <= yMax; v += yLarge) {
        const y = valueToY(v);
        if (y < 8 || y > plotH - 8) continue;
        ctx.fillText(v.toFixed(yDec), MARGIN_LEFT - 4, y);
      }
    }

    // Línea base 0
    if (yMin <= 0 && yMax >= 0) {
      ctx.strokeStyle = COLOR_ZERO;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      const y0 = valueToY(0);
      ctx.moveTo(MARGIN_LEFT, y0);
      ctx.lineTo(w, y0);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // --- Grid X ---
    const { small: tSmall, large: tLarge } = niceInterval(desiredVisibleMs / 1000, 10);
    const tSmallMs = tSmall * 1000;
    const tLargeMs = tLarge * 1000;

    ctx.strokeStyle = COLOR_GRID_SMALL;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    if (data.length >= 2) {
      const firstT = Math.ceil(startTs / tSmallMs) * tSmallMs;
      for (let t = firstT; t <= endTs; t += tSmallMs) {
        const x = tsToX(t);
        if (x < MARGIN_LEFT) continue;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, plotH);
      }
    }
    ctx.stroke();

    ctx.strokeStyle = COLOR_GRID_LARGE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (data.length >= 2) {
      const firstT = Math.ceil(startTs / tLargeMs) * tLargeMs;
      for (let t = firstT; t <= endTs; t += tLargeMs) {
        const x = tsToX(t);
        if (x < MARGIN_LEFT) continue;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, plotH);
      }
    }
    ctx.stroke();

    // Labels X
    if (data.length >= 2) {
      ctx.fillStyle = theme.label;
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const firstT = Math.ceil(startTs / tLargeMs) * tLargeMs;
      for (let t = firstT; t <= endTs; t += tLargeMs) {
        const x = tsToX(t);
        if (x < MARGIN_LEFT + 15 || x > w - 15) continue;
        const relSec = (t - data[0].timestamp_ms) / 1000;
        ctx.fillText(fmtTime(relSec), x, plotH + 4);
      }
    }

    // Unidad Y
    ctx.fillStyle = theme.label;
    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("µV", 2, 4);

    // Barra de referencia 1s
    const bar1sW = pxPerMs * 1000;
    if (bar1sW > 20 && bar1sW < plotW * 0.4) {
      const barY = plotH - 12;
      const barX2 = w - 10;
      const barX1 = barX2 - bar1sW;
      if (barX1 > MARGIN_LEFT + 60) {
        ctx.strokeStyle = theme.label;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(barX1, barY); ctx.lineTo(barX2, barY);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(barX1, barY - 3); ctx.lineTo(barX1, barY + 3);
        ctx.moveTo(barX2, barY - 3); ctx.lineTo(barX2, barY + 3);
        ctx.stroke();
        ctx.font = "8px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText("1s", (barX1 + barX2) / 2, barY - 2);
      }
    }

    // --- Marcadores de fase: PASS 1 (solo bandas de fondo, ANTES del trazo) ---
    for (const m of markers) {
      const cfg = EMG_PHASE_CONFIG[m.type];
      const mStart = m.startMs;
      const mEnd = m.endMs ?? (data.length >= 2 ? data[data.length - 1].timestamp_ms : mStart);
      const x1 = tsToX(mStart);
      const x2 = tsToX(mEnd);
      if (x2 < MARGIN_LEFT || x1 > w) continue;
      const cx1 = Math.max(MARGIN_LEFT, x1);
      const cx2 = Math.min(w, x2);
      ctx.fillStyle = cfg.bg;
      ctx.fillRect(cx1, 0, cx2 - cx1, plotH);
    }

    if (data.length < 2) return;

    // --- Trazo EMG ---
    ctx.save();
    ctx.beginPath();
    ctx.rect(MARGIN_LEFT, 0, plotW, plotH);
    ctx.clip();

    // Glow
    ctx.strokeStyle = COLOR_GLOW;
    ctx.lineWidth = 5;
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

    // Trace
    ctx.strokeStyle = COLOR_TRACE;
    ctx.lineWidth = 1.5;
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

    // --- Marcadores de fase: PASS 2 (anotaciones DESPUÉS del trazo) ---
    for (const m of markers) {
      const cfg = EMG_PHASE_CONFIG[m.type];
      const mStart = m.startMs;
      const mEnd = m.endMs ?? (data.length >= 2 ? data[data.length - 1].timestamp_ms : mStart);
      const x1 = tsToX(mStart);
      const x2 = tsToX(mEnd);
      if (x2 < MARGIN_LEFT || x1 > w) continue;

      const cx1 = Math.max(MARGIN_LEFT, x1);
      const cx2 = Math.min(w, x2);

      // Calcular amplitud dentro de la fase
      let sumSq = 0;
      let count = 0;
      let phaseMin = Infinity;
      let phaseMax = -Infinity;
      for (let i = 0; i < data.length; i++) {
        const pt = data[i];
        if (pt.timestamp_ms < mStart) continue;
        if (pt.timestamp_ms > mEnd) break;
        if (pt.value < phaseMin) phaseMin = pt.value;
        if (pt.value > phaseMax) phaseMax = pt.value;
        sumSq += pt.value * pt.value;
        count++;
      }
      const rmsVal = count > 0 ? Math.sqrt(sumSq / count) : 0;
      const amplitude = isFinite(phaseMax) && isFinite(phaseMin) ? phaseMax - phaseMin : 0;

      // Bordes verticales
      ctx.strokeStyle = cfg.color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      if (x1 >= MARGIN_LEFT) { ctx.moveTo(x1, 0); ctx.lineTo(x1, plotH); }
      if (x2 <= w && m.endMs !== null) { ctx.moveTo(x2, 0); ctx.lineTo(x2, plotH); }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // Flecha de amplitud pico-a-pico + líneas horizontales prominentes
      if (count > 1 && isFinite(phaseMin) && isFinite(phaseMax) && amplitude > 0) {
        const arrowX = Math.min(cx2 - 6, w - 6);
        const yTop = valueToY(phaseMax);
        const yBot = valueToY(phaseMin);

        if (arrowX > cx1 + 20) {
          // Líneas horizontales prominentes en min/max (ancho completo de la banda)
          ctx.strokeStyle = cfg.color;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 0.7;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(cx1, yTop); ctx.lineTo(cx2, yTop);
          ctx.moveTo(cx1, yBot); ctx.lineTo(cx2, yBot);
          ctx.stroke();
          ctx.globalAlpha = 1;

          // Línea vertical con flechas
          ctx.strokeStyle = cfg.color;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 0.8;
          ctx.beginPath();
          ctx.moveTo(arrowX, yTop);
          ctx.lineTo(arrowX, yBot);
          ctx.stroke();
          // Flechitas
          const arrSz = 3;
          ctx.beginPath();
          ctx.moveTo(arrowX - arrSz, yTop + arrSz); ctx.lineTo(arrowX, yTop); ctx.lineTo(arrowX + arrSz, yTop + arrSz);
          ctx.moveTo(arrowX - arrSz, yBot - arrSz); ctx.lineTo(arrowX, yBot); ctx.lineTo(arrowX + arrSz, yBot - arrSz);
          ctx.stroke();
          ctx.globalAlpha = 1;

          // Valor de amplitud al lado de la flecha
          ctx.fillStyle = cfg.color;
          ctx.font = "bold 9px monospace";
          ctx.textAlign = "right";
          ctx.textBaseline = "middle";
          const midY = (yTop + yBot) / 2;
          ctx.fillText(`${amplitude.toFixed(1)}µV`, arrowX - 5, midY);
        }
      }

      // Label superior centrado
      const labelX = (cx1 + cx2) / 2;
      if (cx2 - cx1 > 30) {
        ctx.fillStyle = cfg.color;
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(cfg.label, labelX, 4);

        // Stats debajo del nombre
        const durMs = mEnd - mStart;
        const parts: string[] = [];
        if (durMs > 0) parts.push(durMs >= 1000 ? `${(durMs / 1000).toFixed(1)}s` : `${durMs.toFixed(0)}ms`);
        if (count > 0) parts.push(`RMS:${rmsVal.toFixed(1)}`);
        if (parts.length > 0) {
          ctx.font = "8px monospace";
          ctx.globalAlpha = 0.75;
          ctx.fillText(parts.join(" | "), labelX, 16);
          ctx.globalAlpha = 1;
        }
      }
    }

    // Línea pendiente de marcaje (primer click hecho, esperando segundo)
    if (pendingStartMs != null && activePhase) {
      const px = tsToX(pendingStartMs);
      if (px >= MARGIN_LEFT && px <= w) {
        const pcfg = EMG_PHASE_CONFIG[activePhase];
        ctx.strokeStyle = pcfg.color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, plotH);
        ctx.stroke();
        ctx.setLineDash([]);
        // Label
        ctx.fillStyle = pcfg.color;
        ctx.font = "bold 8px monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText("INICIO ▸", px + 3, plotH - 4);
      }
    }

    ctx.restore();

    // --- Frozen badge + scrollbar ---
    if (frozen) {
      ctx.fillStyle = "rgba(245, 158, 11, 0.7)";
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "right";
      ctx.fillText("CONGELADO", w - 8, 14);

      ctx.fillStyle = theme.label;
      ctx.font = "9px monospace";
      ctx.textAlign = "right";
      ctx.fillText(`-${(offset / 1000).toFixed(1)}s`, w - 8, 26);

      const total = totalMs();
      if (total > 0) {
        const barY = chartH + 2;
        const barW = plotW;
        const barX = MARGIN_LEFT;
        ctx.fillStyle = theme.scrollBg;
        ctx.fillRect(barX, barY, barW, SCROLLBAR_H - 4);
        const thumbRatio = Math.min(1, desiredVisibleMs / total);
        const thumbW = Math.max(20, barW * thumbRatio);
        const scrollableRange = total - desiredVisibleMs;
        const thumbPos = scrollableRange > 0 ? (1 - offset / scrollableRange) * (barW - thumbW) : 0;
        ctx.fillStyle = theme.scrollFg;
        ctx.beginPath();
        ctx.roundRect(barX + thumbPos, barY, thumbW, SCROLLBAR_H - 4, (SCROLLBAR_H - 4) / 2);
        ctx.fill();
      }
    }
  }, [data, frozen, scrollMs, totalMs, markers, activePhase, pendingStartMs]);

  // RAF
  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  // Resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(draw);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

  // Scroll rueda
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!frozen || data.length < 2) return;
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const plotW = container.clientWidth - MARGIN_LEFT;
      const desiredVisibleMs = Math.max(2000, plotW * 6);
      const total = totalMs();
      const maxOff = Math.max(0, total - desiredVisibleMs);
      const step = desiredVisibleMs * 0.2;
      const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      setScrollMs((p) => Math.max(0, Math.min(maxOff, p + (delta > 0 ? 1 : -1) * step)));
    },
    [frozen, data, totalMs],
  );

  // Drag + click para marcaje
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!frozen) return;
      isDragging.current = true;
      didDragRef.current = false;
      dragStartX.current = e.clientX;
      dragStartOff.current = scrollMs;
      e.preventDefault();
    },
    [frozen, scrollMs],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging.current || !frozen || data.length < 2) return;
      if (Math.abs(e.clientX - dragStartX.current) > 3) didDragRef.current = true;
      const dtMs = (e.clientX - dragStartX.current) / pxPerMsRef.current;
      const container = containerRef.current;
      if (!container) return;
      const plotW = container.clientWidth - MARGIN_LEFT;
      const desiredVisibleMs = Math.max(2000, plotW * 6);
      const total = totalMs();
      const maxOff = Math.max(0, total - desiredVisibleMs);
      setScrollMs(Math.max(0, Math.min(maxOff, dragStartOff.current + dtMs)));
    },
    [frozen, data, totalMs],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const wasDragging = isDragging.current;
      isDragging.current = false;

      // Si no hubo drag real y hay herramienta activa → click para marcar
      if (wasDragging && !didDragRef.current && activePhase && onCanvasClick && frozen) {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const ts = viewStartRef.current + (px - MARGIN_LEFT) / pxPerMsRef.current;
        if (ts > 0 && px >= MARGIN_LEFT) onCanvasClick(ts);
      }
    },
    [activePhase, onCanvasClick, frozen],
  );

  const handleMouseLeave = useCallback(() => {
    isDragging.current = false;
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height: "100%", minHeight: 200, cursor: activePhase && frozen ? "crosshair" : frozen ? "grab" : "default" }}
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
