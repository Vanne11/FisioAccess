import { useRef, useEffect, useCallback, useMemo } from "react";
import type { EMGDataPoint, EMGPhaseMarker, EMGPhaseType, EMGPhaseStats } from "./EMGCanvas";
import { EMG_PHASE_CONFIG } from "./EMGCanvas";

interface PhaseComparisonProps {
  data: EMGDataPoint[];
  markers: EMGPhaseMarker[];
  className?: string;
}

const MINI_H = 120;
const MINI_MARGIN_L = 36;
const MINI_MARGIN_B = 16;
const PHASE_ORDER: EMGPhaseType[] = ["reposo", "leve", "maxima"];

function getThemeColors() {
  const s = getComputedStyle(document.documentElement);
  return {
    bg: s.getPropertyValue("--color-surface-950").trim() || "#020617",
    label: s.getPropertyValue("--color-secondary").trim() || "#64748b",
    cardBg: s.getPropertyValue("--color-surface-900").trim() || "#0f172a",
  };
}

/** Compute stats for a phase marker */
function computePhaseStats(data: EMGDataPoint[], m: EMGPhaseMarker): EMGPhaseStats {
  const mEnd = m.endMs ?? (data.length > 0 ? data[data.length - 1].timestamp_ms : m.startMs);
  let sumSq = 0;
  let count = 0;
  let mn = Infinity;
  let mx = -Infinity;
  for (const pt of data) {
    if (pt.timestamp_ms < m.startMs) continue;
    if (pt.timestamp_ms > mEnd) break;
    if (pt.value < mn) mn = pt.value;
    if (pt.value > mx) mx = pt.value;
    sumSq += pt.value * pt.value;
    count++;
  }
  const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
  const pp = isFinite(mx) && isFinite(mn) ? mx - mn : 0;
  return {
    id: m.id,
    type: m.type,
    rms,
    peakPositive: isFinite(mx) ? mx : 0,
    peakNegative: isFinite(mn) ? mn : 0,
    peakToPeak: pp,
    duration: mEnd - m.startMs,
    count,
  };
}

/** Estimate median frequency using zero-crossings */
function estimateMedianFreq(data: EMGDataPoint[], startMs: number, endMs: number): number {
  let crossings = 0;
  let prev = 0;
  let count = 0;
  for (const pt of data) {
    if (pt.timestamp_ms < startMs) continue;
    if (pt.timestamp_ms > endMs) break;
    if (count > 0 && prev * pt.value < 0) crossings++;
    prev = pt.value;
    count++;
  }
  const durationSec = (endMs - startMs) / 1000;
  if (durationSec <= 0 || count < 2) return 0;
  return (crossings / 2) / durationSec;
}

function MiniChart({
  data, marker, yMin, yMax, width,
}: {
  data: EMGDataPoint[];
  marker: EMGPhaseMarker;
  yMin: number;
  yMax: number;
  width: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const drawMini = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const theme = getThemeColors();
    const dpr = window.devicePixelRatio || 1;
    const w = width;
    const h = MINI_H;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const cfg = EMG_PHASE_CONFIG[marker.type];
    const plotW = w - MINI_MARGIN_L;
    const plotH = h - MINI_MARGIN_B;

    // Background
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);

    // Phase tint
    ctx.fillStyle = cfg.bg;
    ctx.fillRect(MINI_MARGIN_L, 0, plotW, plotH);

    const mEnd = marker.endMs ?? (data.length > 0 ? data[data.length - 1].timestamp_ms : marker.startMs);
    const mDur = mEnd - marker.startMs;
    if (mDur <= 0) return;

    const valueToY = (v: number) => (1 - (v - yMin) / (yMax - yMin)) * plotH;
    const tsToX = (ts: number) => MINI_MARGIN_L + ((ts - marker.startMs) / mDur) * plotW;

    // Grid Y
    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 0.5;
    const steps = 4;
    for (let i = 1; i < steps; i++) {
      const y = plotH * (i / steps);
      ctx.beginPath();
      ctx.moveTo(MINI_MARGIN_L, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Zero line
    if (yMin < 0 && yMax > 0) {
      const y0 = valueToY(0);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(MINI_MARGIN_L, y0);
      ctx.lineTo(w, y0);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Y labels
    ctx.fillStyle = theme.label;
    ctx.font = "7px monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(`${yMax.toFixed(0)}`, MINI_MARGIN_L - 2, 6);
    ctx.fillText(`${yMin.toFixed(0)}`, MINI_MARGIN_L - 2, plotH - 2);

    // Trace
    ctx.save();
    ctx.beginPath();
    ctx.rect(MINI_MARGIN_L, 0, plotW, plotH);
    ctx.clip();

    ctx.strokeStyle = cfg.color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    let started = false;
    for (const pt of data) {
      if (pt.timestamp_ms < marker.startMs) continue;
      if (pt.timestamp_ms > mEnd) break;
      const x = tsToX(pt.timestamp_ms);
      const y = valueToY(pt.value);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();

    // Phase label
    ctx.fillStyle = cfg.color;
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(cfg.label, MINI_MARGIN_L + plotW / 2, h - 2);

    // Border
    ctx.strokeStyle = cfg.color;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }, [data, marker, yMin, yMax, width]);

  useEffect(() => {
    drawMini();
  }, [drawMini]);

  return <canvas ref={canvasRef} style={{ display: "block" }} />;
}

export function PhaseComparison({ data, markers, className }: PhaseComparisonProps) {
  // Find first marker for each phase type
  const phaseMarkers = useMemo(() => {
    const result: Partial<Record<EMGPhaseType, EMGPhaseMarker>> = {};
    for (const m of markers) {
      if (m.endMs !== null && !result[m.type]) {
        result[m.type] = m;
      }
    }
    return result;
  }, [markers]);

  const stats = useMemo(() => {
    const result: Partial<Record<EMGPhaseType, EMGPhaseStats & { medianFreq: number }>> = {};
    for (const phase of PHASE_ORDER) {
      const m = phaseMarkers[phase];
      if (!m) continue;
      const s = computePhaseStats(data, m);
      const mEnd = m.endMs ?? (data.length > 0 ? data[data.length - 1].timestamp_ms : m.startMs);
      const medianFreq = estimateMedianFreq(data, m.startMs, mEnd);
      result[phase] = { ...s, medianFreq };
    }
    return result;
  }, [data, phaseMarkers]);

  // Find MVC RMS for %MVC calculation
  const mvcRms = stats.maxima?.rms ?? 0;

  // Unified Y scale across all mini-charts
  const unifiedScale = useMemo(() => {
    let mn = Infinity;
    let mx = -Infinity;
    for (const phase of PHASE_ORDER) {
      const m = phaseMarkers[phase];
      if (!m) continue;
      const mEnd = m.endMs ?? (data.length > 0 ? data[data.length - 1].timestamp_ms : m.startMs);
      for (const pt of data) {
        if (pt.timestamp_ms < m.startMs) continue;
        if (pt.timestamp_ms > mEnd) break;
        if (pt.value < mn) mn = pt.value;
        if (pt.value > mx) mx = pt.value;
      }
    }
    if (!isFinite(mn) || !isFinite(mx)) { mn = -10; mx = 10; }
    const pad = (mx - mn) * 0.1;
    return { yMin: mn - pad, yMax: mx + pad };
  }, [data, phaseMarkers]);

  const activePhasesCount = PHASE_ORDER.filter(p => phaseMarkers[p]).length;

  if (activePhasesCount === 0) {
    return (
      <div className={`text-center text-xs text-secondary py-4 ${className ?? ""}`}>
        Marca al menos una fase (reposo, leve o MVC) para ver la comparación
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex gap-2">
        {PHASE_ORDER.map((phase) => {
          const m = phaseMarkers[phase];
          const s = stats[phase];
          const cfg = EMG_PHASE_CONFIG[phase];

          if (!m) {
            return (
              <div key={phase} className="flex-1 min-w-0 rounded border border-surface-700 bg-surface-900 flex items-center justify-center" style={{ height: MINI_H }}>
                <span className="text-[10px] text-secondary">{cfg.label}: sin datos</span>
              </div>
            );
          }

          return (
            <div key={phase} className="flex-1 min-w-0 flex flex-col gap-1">
              <MiniChart
                data={data}
                marker={m}
                yMin={unifiedScale.yMin}
                yMax={unifiedScale.yMax}
                width={200}
              />
              {s && (
                <div className="text-[10px] font-mono bg-surface-900 rounded p-1.5 space-y-0.5" style={{ borderLeft: `3px solid ${cfg.color}` }}>
                  <div className="flex justify-between">
                    <span className="text-secondary">RMS</span>
                    <span style={{ color: cfg.color }}>{s.rms.toFixed(3)} mV</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-secondary">P-P</span>
                    <span style={{ color: cfg.color }}>{s.peakToPeak.toFixed(3)} mV</span>
                  </div>
                  {mvcRms > 0 && (
                    <div className="flex justify-between">
                      <span className="text-secondary">%MVC</span>
                      <span style={{ color: cfg.color }}>{((s.rms / mvcRms) * 100).toFixed(1)}%</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-secondary">Freq</span>
                    <span style={{ color: cfg.color }}>{s.medianFreq.toFixed(0)} Hz</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
