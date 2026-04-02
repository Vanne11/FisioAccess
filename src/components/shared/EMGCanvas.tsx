import { useRef, useEffect, useCallback, useState } from "react";

export interface EMGDataPoint {
  timestamp_ms: number;
  /** Señal filtrada (forma de onda) */
  filtered: number;
  /** Envolvente suavizada (amplitud de contracción) */
  envelope: number;
}

export type EMGPhaseType = "reposo" | "leve" | "maxima" | "relajacion";

export interface EMGPhaseMarker {
  id: string;
  type: EMGPhaseType;
  startMs: number;
  endMs: number | null; // null = en curso
  customLabel?: string; // nombre editable por el usuario
  labelX?: number;      // offset X en ms de la etiqueta (default 0 = centrada en fase)
  labelY?: number;      // offset Y como fracción de plotH (default 0 = top)
  labelAngle?: number;  // rotación en grados de la etiqueta (default 0)
}

export interface EMGPhaseStats {
  id: string;
  type: EMGPhaseType;
  rms: number;
  peakPositive: number;
  peakNegative: number;
  peakToPeak: number;
  duration: number;
  count: number;
  mvcPercent?: number;
}

export const EMG_PHASE_CONFIG: Record<EMGPhaseType, { label: string; color: string; bg: string }> = {
  reposo:      { label: "Reposo",             color: "#38bdf8", bg: "rgba(56, 189, 248, 0.12)" },
  leve:        { label: "Contracción leve",   color: "#fbbf24", bg: "rgba(251, 191, 36, 0.12)" },
  maxima:      { label: "Contracción máxima", color: "#f87171", bg: "rgba(248, 113, 113, 0.12)" },
  relajacion:  { label: "Relajación",         color: "#4ade80", bg: "rgba(74, 222, 128, 0.12)" },
};

export const SCALE_PRESETS = [0.5, 1, 2, 5] as const;

export interface ADCConfig {
  vref: number;       // ADC voltage reference in mV/LSB (default 0.1875)
  resolution: number; // ADC bits (default 16)
  offset: number;     // DC offset in mV (default 1768)
}

export const DEFAULT_ADC_CONFIG: ADCConfig = {
  vref: 0.125,
  resolution: 16,
  offset: 1768,
};

interface EMGCanvasProps {
  data: EMGDataPoint[];
  frozen: boolean;
  markers?: EMGPhaseMarker[];
  activePhase?: EMGPhaseType | null;
  pendingStartMs?: number | null;
  onCanvasClick?: (timestamp_ms: number) => void;
  onMarkerUpdate?: (id: string, startMs: number, endMs: number) => void;
  /** Drag = mover (X+Y), R = girar +15°, Shift+R = girar -15° */
  onMarkerLabelTransform?: (id: string, labelX: number, labelY: number, labelAngle: number) => void;
  scalePreset?: number | null; // ±N mV, null = auto
  showRmsEnvelope?: boolean;
  showCalBar?: boolean;
  className?: string;
  /** Called on each frame with the current auto-scale range (±mV) */
  onAutoScaleChange?: (range: number) => void;
}

const MARGIN_LEFT = 52;
const MARGIN_BOTTOM = 24;
const SCROLLBAR_H = 14;
const CAL_BAR_W = 8;
const COLOR_GRID_SMALL = "rgba(245, 158, 11, 0.10)";
const COLOR_GRID_LARGE = "rgba(245, 158, 11, 0.22)";
const COLOR_TRACE = "rgba(245, 158, 11, 1)";
const COLOR_GLOW = "rgba(245, 158, 11, 0.12)";
const COLOR_ZERO = "rgba(255, 255, 255, 0.15)";
const COLOR_RMS_ENVELOPE = "rgba(168, 85, 247, 0.65)";

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

function decFor(step: number): number {
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  if (step >= 0.01) return 2;
  return 3;
}

function fmtTime(sec: number): string {
  if (sec >= 60) return `${(sec / 60).toFixed(1)}m`;
  if (sec >= 10) return `${sec.toFixed(0)}s`;
  if (sec >= 1) return `${sec.toFixed(1)}s`;
  return `${(sec * 1000).toFixed(0)}ms`;
}

const EDGE_GRAB_PX = 6;

/** Pick the next "nice" symmetric scale ±N from a set of nice values */
function niceSymmetricScale(peakAbs: number): number {
  if (peakAbs <= 0) return 10;
  // Nice steps: 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000…
  const mag = Math.pow(10, Math.floor(Math.log10(peakAbs)));
  const norm = peakAbs / mag;
  if (norm <= 1) return 1 * mag;
  if (norm <= 2) return 2 * mag;
  if (norm <= 5) return 5 * mag;
  return 10 * mag;
}

export function EMGCanvas({
  data, frozen, markers = [], activePhase, pendingStartMs,
  onCanvasClick, onMarkerUpdate, onMarkerLabelTransform, scalePreset, showRmsEnvelope, showCalBar,
  className, onAutoScaleChange,
}: EMGCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  const [scrollMs, setScrollMs] = useState(0);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartOff = useRef(0);
  const pxPerMsRef = useRef(0.1);
  const viewStartRef = useRef(0);
  const didDragRef = useRef(false);

  // Smoothed auto-scale state
  const autoScaleRef = useRef<number>(1); // current smoothed ±mV range
  const autoScaleLastReport = useRef<number>(0);

  // Draggable marker edge state
  const draggingEdge = useRef<{ markerId: string; edge: "start" | "end"; origMs: number } | null>(null);
  // Draggable label state: drag = mover XY, R key = girar
  const draggingLabel = useRef<{
    markerId: string;
    mode: "move" | "rotate";
    startMouseX: number;
    startMouseY: number;
    startLabelX: number;
    startLabelY: number;
    startAngle: number;
  } | null>(null);
  const labelRectsRef = useRef<{ id: string; x: number; y: number; w: number; h: number }[]>([]);
  const [cursorStyle, setCursorStyle] = useState<string>("default");
  const lastMousePosRef = useRef<{ x: number; y: number } | null>(null);

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

    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, fullH);

    const plotW = w - MARGIN_LEFT;
    const desiredVisibleMs = Math.max(2000, plotW * 6);
    const offset = frozen ? scrollMs : 0;
    const lastTs = data.length >= 2 ? data[data.length - 1].timestamp_ms : 0;
    const endTs = lastTs - offset;
    const startTs = endTs - desiredVisibleMs;
    const pxPerMs = plotW / desiredVisibleMs;
    pxPerMsRef.current = pxPerMs;
    viewStartRef.current = startTs;

    const tsToX = (ts: number) => MARGIN_LEFT + (ts - startTs) * pxPerMs;

    // Binary search for start index
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

    // Y scale: preset or auto (smoothed)
    let yMin: number;
    let yMax: number;
    if (scalePreset != null && scalePreset > 0) {
      yMin = -scalePreset;
      yMax = scalePreset;
      autoScaleRef.current = scalePreset;
    } else {
      // Find visible data peak
      let visMin = Infinity;
      let visMax = -Infinity;
      if (data.length >= 2) {
        for (let i = startIdx; i < data.length; i++) {
          const pt = data[i];
          if (pt.timestamp_ms > endTs) break;
          if (pt.timestamp_ms < startTs) continue;
          if (pt.filtered < visMin) visMin = pt.filtered;
          if (pt.filtered > visMax) visMax = pt.filtered;
        }
      }
      if (!isFinite(visMin) || !isFinite(visMax) || visMin === visMax) {
        visMin = -10;
        visMax = 10;
      }

      // Desired symmetric range = nice step above peak absolute value + padding
      const peakAbs = Math.max(Math.abs(visMin), Math.abs(visMax));
      const desired = niceSymmetricScale(peakAbs * 1.15); // 15% padding

      const prev = autoScaleRef.current;
      let next: number;
      if (desired > prev) {
        // Expand fast (instant)
        next = desired;
      } else if (desired < prev * 0.5) {
        // Shrink with decay when signal is much smaller (hysteresis)
        next = prev * 0.92; // gradual shrink per frame
        // Snap if close enough
        if (next < desired * 1.05) next = desired;
      } else {
        // Within hysteresis band — keep current
        next = prev;
      }
      // Enforce minimum
      if (next < 0.05) next = 0.05;
      autoScaleRef.current = next;

      yMin = -next;
      yMax = next;

      // Report auto-scale to parent (throttled)
      if (onAutoScaleChange) {
        const rounded = Math.round(next);
        if (rounded !== autoScaleLastReport.current) {
          autoScaleLastReport.current = rounded;
          onAutoScaleChange(rounded);
        }
      }
    }

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

    // Zero line
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

    // Unit label
    ctx.fillStyle = theme.label;
    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("mV", 2, 4);

    // 1s reference bar
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

    // --- Calibration amplitude bar (left margin) ---
    if (showCalBar) {
      const calBarX = 6;
      const calBarTop = 20;
      const calBarBot = plotH - 8;
      const calBarH = calBarBot - calBarTop;
      const totalRange = yMax - yMin;

      // Background
      ctx.fillStyle = "rgba(245, 158, 11, 0.08)";
      ctx.fillRect(calBarX, calBarTop, CAL_BAR_W, calBarH);

      // Graduated marks
      const calSteps = [0.25, 0.5, 0.75];
      ctx.strokeStyle = "rgba(245, 158, 11, 0.3)";
      ctx.lineWidth = 0.5;
      for (const frac of calSteps) {
        const y = calBarTop + calBarH * (1 - frac);
        ctx.beginPath();
        ctx.moveTo(calBarX, y);
        ctx.lineTo(calBarX + CAL_BAR_W, y);
        ctx.stroke();
      }

      // Fill based on signal amplitude (peak-to-peak of visible data)
      let visMin = Infinity, visMax = -Infinity;
      for (let i = startIdx; i < data.length; i++) {
        const pt = data[i];
        if (pt.timestamp_ms > endTs) break;
        if (pt.timestamp_ms < startTs) continue;
        if (pt.filtered < visMin) visMin = pt.filtered;
        if (pt.filtered > visMax) visMax = pt.filtered;
      }
      if (isFinite(visMin) && isFinite(visMax)) {
        const pp = visMax - visMin;
        const fillRatio = Math.min(1, pp / totalRange);
        const fillH = calBarH * fillRatio;
        ctx.fillStyle = "rgba(245, 158, 11, 0.4)";
        ctx.fillRect(calBarX, calBarBot - fillH, CAL_BAR_W, fillH);
      }

      // Border
      ctx.strokeStyle = "rgba(245, 158, 11, 0.3)";
      ctx.lineWidth = 1;
      ctx.strokeRect(calBarX, calBarTop, CAL_BAR_W, calBarH);

      // Scale label
      ctx.fillStyle = theme.label;
      ctx.font = "7px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const scaleLabel = scalePreset ? `±${scalePreset}` : `${totalRange.toFixed(0)}`;
      ctx.fillText(scaleLabel, calBarX + CAL_BAR_W / 2, calBarBot + 2);
    }

    // --- Phase markers PASS 1: background bands ---
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

    // --- EMG Trace ---
    ctx.save();
    ctx.beginPath();
    ctx.rect(MARGIN_LEFT, 0, plotW, plotH);
    ctx.clip();

    // Glow (filtered waveform)
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
      const y = valueToY(pt.filtered);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Main trace (filtered waveform)
    ctx.strokeStyle = COLOR_TRACE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    started = false;
    for (let i = startIdx; i < data.length; i++) {
      const pt = data[i];
      if (pt.timestamp_ms > endTs) break;
      if (pt.timestamp_ms < startTs) continue;
      const x = tsToX(pt.timestamp_ms);
      const y = valueToY(pt.filtered);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // --- Envelope (toggled by RMS button) ---
    if (showRmsEnvelope) {
      ctx.strokeStyle = COLOR_RMS_ENVELOPE;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      let envStarted = false;
      for (let i = startIdx; i < data.length; i++) {
        const pt = data[i];
        if (pt.timestamp_ms > endTs) break;
        if (pt.timestamp_ms < startTs) continue;
        const x = tsToX(pt.timestamp_ms);
        const y = valueToY(pt.envelope);
        if (!envStarted) { ctx.moveTo(x, y); envStarted = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Mirrored negative envelope
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      envStarted = false;
      for (let i = startIdx; i < data.length; i++) {
        const pt = data[i];
        if (pt.timestamp_ms > endTs) break;
        if (pt.timestamp_ms < startTs) continue;
        const x = tsToX(pt.timestamp_ms);
        const y = valueToY(-pt.envelope);
        if (!envStarted) { ctx.moveTo(x, y); envStarted = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // --- Phase markers PASS 2: annotations ON TOP of trace ---
    const labelRects: { id: string; x: number; y: number; w: number; h: number }[] = [];
    for (const m of markers) {
      const cfg = EMG_PHASE_CONFIG[m.type];
      const mStart = m.startMs;
      const mEnd = m.endMs ?? (data.length >= 2 ? data[data.length - 1].timestamp_ms : mStart);
      const x1 = tsToX(mStart);
      const x2 = tsToX(mEnd);
      if (x2 < MARGIN_LEFT || x1 > w) continue;

      const cx1 = Math.max(MARGIN_LEFT, x1);
      const cx2 = Math.min(w, x2);

      // Compute phase stats
      let sumSq = 0;
      let count = 0;
      let phaseMin = Infinity;
      let phaseMax = -Infinity;
      for (let i = 0; i < data.length; i++) {
        const pt = data[i];
        if (pt.timestamp_ms < mStart) continue;
        if (pt.timestamp_ms > mEnd) break;
        if (pt.filtered < phaseMin) phaseMin = pt.filtered;
        if (pt.filtered > phaseMax) phaseMax = pt.filtered;
        sumSq += pt.filtered * pt.filtered;
        count++;
      }
      const rmsVal = count > 0 ? Math.sqrt(sumSq / count) : 0;
      const amplitude = isFinite(phaseMax) && isFinite(phaseMin) ? phaseMax - phaseMin : 0;

      // Vertical border lines
      ctx.strokeStyle = cfg.color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      if (x1 >= MARGIN_LEFT) { ctx.moveTo(x1, 0); ctx.lineTo(x1, plotH); }
      if (x2 <= w && m.endMs !== null) { ctx.moveTo(x2, 0); ctx.lineTo(x2, plotH); }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // --- RMS horizontal dashed line ---
      if (count > 1 && rmsVal > 0) {
        const yRms = valueToY(rmsVal);
        const yRmsNeg = valueToY(-rmsVal);
        ctx.strokeStyle = cfg.color;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(cx1, yRms); ctx.lineTo(cx2, yRms);
        ctx.moveTo(cx1, yRmsNeg); ctx.lineTo(cx2, yRmsNeg);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;

        // RMS value label
        ctx.fillStyle = cfg.color;
        ctx.font = "bold 8px monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.globalAlpha = 0.7;
        ctx.fillText(`RMS ${rmsVal.toFixed(1)}`, cx1 + 3, yRms - 2);
        ctx.globalAlpha = 1;
      }

      // --- Peak amplitude lines + arrow ---
      if (count > 1 && isFinite(phaseMin) && isFinite(phaseMax) && amplitude > 0) {
        const arrowX = Math.min(cx2 - 6, w - 6);
        const yTop = valueToY(phaseMax);
        const yBot = valueToY(phaseMin);

        if (arrowX > cx1 + 20) {
          // Solid horizontal lines at peak+ and peak- (full band width)
          ctx.strokeStyle = cfg.color;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 0.7;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(cx1, yTop); ctx.lineTo(cx2, yTop);
          ctx.moveTo(cx1, yBot); ctx.lineTo(cx2, yBot);
          ctx.stroke();
          ctx.globalAlpha = 1;

          // Peak value labels at ends
          ctx.fillStyle = cfg.color;
          ctx.font = "7px monospace";
          ctx.globalAlpha = 0.6;
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.fillText(`+${phaseMax.toFixed(1)}`, cx1 + 2, yTop + 1);
          ctx.textBaseline = "bottom";
          ctx.fillText(`${phaseMin.toFixed(1)}`, cx1 + 2, yBot - 1);
          ctx.globalAlpha = 1;

          // Vertical arrow connecting min↔max
          ctx.strokeStyle = cfg.color;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 0.8;
          ctx.beginPath();
          ctx.moveTo(arrowX, yTop);
          ctx.lineTo(arrowX, yBot);
          ctx.stroke();
          // Arrowheads
          const arrSz = 3;
          ctx.beginPath();
          ctx.moveTo(arrowX - arrSz, yTop + arrSz); ctx.lineTo(arrowX, yTop); ctx.lineTo(arrowX + arrSz, yTop + arrSz);
          ctx.moveTo(arrowX - arrSz, yBot - arrSz); ctx.lineTo(arrowX, yBot); ctx.lineTo(arrowX + arrSz, yBot - arrSz);
          ctx.stroke();
          ctx.globalAlpha = 1;

          // Amplitude value next to arrow
          ctx.fillStyle = cfg.color;
          ctx.font = "bold 9px monospace";
          ctx.textAlign = "right";
          ctx.textBaseline = "middle";
          const midY = (yTop + yBot) / 2;
          ctx.fillText(`${amplitude.toFixed(2)}mV`, arrowX - 5, midY);
          // P-P label
          ctx.font = "7px monospace";
          ctx.globalAlpha = 0.6;
          ctx.fillText("P-P", arrowX - 5, midY + 10);
          ctx.globalAlpha = 1;
        }
      }

      // --- Phase label + stats (draggable + rotatable) ---
      const labelX = (cx1 + cx2) / 2 + (m.labelX ?? 0) * pxPerMs;
      if (cx2 - cx1 > 30) {
        const lBaseY = 1 + (m.labelY ?? 0) * plotH;
        const lH = 30;
        const textW = Math.min(cx2 - cx1 - 4, 140);
        const angleDeg = m.labelAngle ?? 0;
        const angleRad = (angleDeg * Math.PI) / 180;

        // Clamp to plot area
        const lY = Math.max(0, Math.min(plotH - lH, lBaseY));

        ctx.save();
        ctx.translate(labelX, lY + lH / 2);
        ctx.rotate(angleRad);

        // Background for text readability
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.fillRect(-textW / 2, -lH / 2, textW, lH);

        // Drag handle hint (small grip dots)
        ctx.fillStyle = "rgba(255,255,255,0.2)";
        for (let dy = -7; dy <= 1; dy += 4) {
          ctx.fillRect(-textW / 2 + 3, dy, 2, 2);
        }

        ctx.fillStyle = cfg.color;
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(m.customLabel || cfg.label, 0, -lH / 2 + 2);

        // Stats line 1: duration + RMS
        const durMs = mEnd - mStart;
        const durStr = durMs >= 1000 ? `${(durMs / 1000).toFixed(1)}s` : `${durMs.toFixed(0)}ms`;
        ctx.font = "8px monospace";
        ctx.globalAlpha = 0.8;
        ctx.fillText(`${durStr} | RMS:${rmsVal.toFixed(2)}mV`, 0, -lH / 2 + 13);
        // Stats line 2: P-P
        if (amplitude > 0) {
          ctx.fillText(`P-P:${amplitude.toFixed(2)}mV`, 0, -lH / 2 + 22);
        }
        ctx.globalAlpha = 1;

        // Rotate hint icon
        if (angleDeg !== 0) {
          ctx.fillStyle = "rgba(255,255,255,0.25)";
          ctx.font = "7px monospace";
          ctx.textAlign = "right";
          ctx.textBaseline = "bottom";
          ctx.fillText(`${angleDeg}°`, textW / 2 - 2, -lH / 2 + lH - 1);
        }

        ctx.restore();

        // Store rect for hit-testing (axis-aligned bounding box)
        labelRects.push({ id: m.id, x: labelX - textW / 2, y: lY, w: textW, h: lH });
      }
    }
    labelRectsRef.current = labelRects;

    // Pending marker line
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
        ctx.fillStyle = pcfg.color;
        ctx.font = "bold 8px monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText("INICIO \u25B8", px + 3, plotH - 4);
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
  }, [data, frozen, scrollMs, totalMs, markers, activePhase, pendingStartMs, scalePreset, showRmsEnvelope, showCalBar, onAutoScaleChange]);

  // RAF — continuous loop when auto-scaling (for smooth shrink animation)
  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      draw();
      // Keep looping when recording (data changes) or auto-scale may be animating
      if (!frozen || scalePreset == null) {
        rafRef.current = requestAnimationFrame(loop);
      }
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [draw, frozen, scalePreset]);

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

  // Rotate label with R key (no mode, no drag — just press R while hovering)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onMarkerLabelTransform) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "r" && e.key !== "R") return;
      const pos = lastMousePosRef.current;
      if (!pos) return;

      // Hit-test against label rects using stored client coords
      const rect = container.getBoundingClientRect();
      const px = pos.x - rect.left;
      const py = pos.y - rect.top;
      for (const lr of labelRectsRef.current) {
        if (px >= lr.x && px <= lr.x + lr.w && py >= lr.y && py <= lr.y + lr.h) {
          e.preventDefault();
          const marker = markers.find(m => m.id === lr.id);
          if (marker) {
            const delta = e.shiftKey ? -15 : 15;
            const newAngle = (marker.labelAngle ?? 0) + delta;
            onMarkerLabelTransform(marker.id, marker.labelX ?? 0, marker.labelY ?? 0, newAngle);
          }
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [markers, onMarkerLabelTransform]);

  // Find if mouse is near a marker edge
  const findNearEdge = useCallback((clientX: number): { markerId: string; edge: "start" | "end"; ms: number } | null => {
    if (!frozen || !containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const px = clientX - rect.left;

    for (const m of markers) {
      if (m.endMs === null) continue;
      const mEnd = m.endMs;
      const startX = MARGIN_LEFT + (m.startMs - viewStartRef.current) * pxPerMsRef.current;
      const endX = MARGIN_LEFT + (mEnd - viewStartRef.current) * pxPerMsRef.current;

      if (Math.abs(px - startX) <= EDGE_GRAB_PX) {
        return { markerId: m.id, edge: "start", ms: m.startMs };
      }
      if (Math.abs(px - endX) <= EDGE_GRAB_PX) {
        return { markerId: m.id, edge: "end", ms: mEnd };
      }
    }
    return null;
  }, [frozen, markers]);

  // Find if mouse is over a label rect
  const findLabelHit = useCallback((clientX: number, clientY: number): string | null => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    for (const lr of labelRectsRef.current) {
      if (px >= lr.x && px <= lr.x + lr.w && py >= lr.y && py <= lr.y + lr.h) {
        return lr.id;
      }
    }
    return null;
  }, []);

  // Wheel: scroll timeline
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

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!frozen) return;

      // Check for label drag (move XY)
      if (onMarkerLabelTransform) {
        const labelId = findLabelHit(e.clientX, e.clientY);
        if (labelId) {
          const marker = markers.find(m => m.id === labelId);
          draggingLabel.current = {
            markerId: labelId,
            mode: "move",
            startMouseX: e.clientX,
            startMouseY: e.clientY,
            startLabelX: marker?.labelX ?? 0,
            startLabelY: marker?.labelY ?? 0,
            startAngle: marker?.labelAngle ?? 0,
          };
          e.preventDefault();
          return;
        }
      }

      // Check for marker edge drag
      const edge = findNearEdge(e.clientX);
      if (edge && onMarkerUpdate) {
        draggingEdge.current = { markerId: edge.markerId, edge: edge.edge, origMs: edge.ms };
        e.preventDefault();
        return;
      }

      isDragging.current = true;
      didDragRef.current = false;
      dragStartX.current = e.clientX;
      dragStartOff.current = scrollMs;
      e.preventDefault();
    },
    [frozen, scrollMs, findNearEdge, onMarkerUpdate, onMarkerLabelTransform, markers, findLabelHit],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // Track mouse position for R-key rotation hit-test
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };

      // Handle label dragging (move XY or rotate)
      if (draggingLabel.current && onMarkerLabelTransform) {
        const dl = draggingLabel.current;
        const dx = e.clientX - dl.startMouseX;
        const dy = e.clientY - dl.startMouseY;
        if (dl.mode === "rotate") {
          const newAngle = dl.startAngle + dx * 0.5;
          onMarkerLabelTransform(dl.markerId, dl.startLabelX, dl.startLabelY, Math.round(newAngle));
        } else {
          // Convert pixel deltas to ms (X) and fraction of plotH (Y)
          const dxMs = pxPerMsRef.current > 0 ? dx / pxPerMsRef.current : 0;
          const container = containerRef.current;
          const currentPlotH = container ? (frozen ? container.clientHeight - SCROLLBAR_H : container.clientHeight) - MARGIN_BOTTOM : 1;
          const dyFrac = currentPlotH > 0 ? dy / currentPlotH : 0;
          onMarkerLabelTransform(dl.markerId, dl.startLabelX + dxMs, dl.startLabelY + dyFrac, dl.startAngle);
        }
        return;
      }

      // Handle marker edge dragging
      if (draggingEdge.current && onMarkerUpdate) {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const ts = viewStartRef.current + (px - MARGIN_LEFT) / pxPerMsRef.current;
        const marker = markers.find(m => m.id === draggingEdge.current!.markerId);
        if (marker && marker.endMs !== null) {
          if (draggingEdge.current.edge === "start") {
            const newStart = Math.min(ts, marker.endMs - 10);
            onMarkerUpdate(marker.id, newStart, marker.endMs);
          } else {
            const newEnd = Math.max(ts, marker.startMs + 10);
            onMarkerUpdate(marker.id, marker.startMs, newEnd);
          }
        }
        return;
      }

      // Cursor hint for labels and edges
      if (!isDragging.current && !draggingLabel.current && frozen) {
        const labelHit = onMarkerLabelTransform ? findLabelHit(e.clientX, e.clientY) : null;
        if (labelHit) {
          setCursorStyle("move");
        } else if (onMarkerUpdate) {
          const edge = findNearEdge(e.clientX);
          if (edge) {
            setCursorStyle("col-resize");
          } else if (activePhase) {
            setCursorStyle("crosshair");
          } else {
            setCursorStyle("grab");
          }
        }
      }

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
    [frozen, data, totalMs, markers, activePhase, onMarkerUpdate, onMarkerLabelTransform, findNearEdge, findLabelHit],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (draggingLabel.current) {
        draggingLabel.current = null;
        return;
      }

      if (draggingEdge.current) {
        draggingEdge.current = null;
        return;
      }

      const wasDragging = isDragging.current;
      isDragging.current = false;

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
    draggingEdge.current = null;
    draggingLabel.current = null;
    lastMousePosRef.current = null;
  }, []);

  const cursor = frozen
    ? cursorStyle
    : "default";

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height: "100%", minHeight: 200, cursor }}
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
