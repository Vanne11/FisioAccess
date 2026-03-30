import { useRef, useEffect, useCallback } from "react";

export interface VUThresholds {
  reposo: number;   // Max RMS for rest zone (green)
  leve: number;     // Max RMS for light contraction (yellow)
  mvc: number;      // Max RMS displayed (red zone cap)
}

export const DEFAULT_THRESHOLDS: VUThresholds = {
  reposo: 0.05,
  leve: 0.5,
  mvc: 5.0,
};

export type CalibrationStep = "idle" | "reposo" | "leve" | "mvc" | "done";

interface VUMeterProps {
  rmsValue: number;
  thresholds: VUThresholds;
  calibrationStep?: CalibrationStep;
  calibrationProgress?: number; // 0-1
  height?: number;
}

const BAR_W = 28;
const PADDING = 4;
const LABEL_H = 12;

const COLOR_GREEN = "#22c55e";
const COLOR_YELLOW = "#eab308";
const COLOR_RED = "#ef4444";
const COLOR_BG = "rgba(30, 41, 59, 0.8)";

function getThemeColors() {
  const s = getComputedStyle(document.documentElement);
  return {
    bg: s.getPropertyValue("--color-surface-950").trim() || "#020617",
    label: s.getPropertyValue("--color-secondary").trim() || "#64748b",
  };
}

export function VUMeter({ rmsValue, thresholds, calibrationStep = "idle", calibrationProgress = 0, height = 300 }: VUMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const smoothedRef = useRef(0);
  const peakRef = useRef(0);
  const peakDecayRef = useRef(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const theme = getThemeColors();
    const dpr = window.devicePixelRatio || 1;
    const totalW = BAR_W + PADDING * 2 + 24; // bar + labels
    const totalH = height;

    canvas.width = totalW * dpr;
    canvas.height = totalH * dpr;
    canvas.style.width = `${totalW}px`;
    canvas.style.height = `${totalH}px`;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, totalW, totalH);

    const barX = PADDING;
    const barTop = LABEL_H + PADDING;
    const barBot = totalH - LABEL_H - PADDING;
    const barH = barBot - barTop;

    // Smoothing
    const target = Math.min(rmsValue, thresholds.mvc * 1.2);
    smoothedRef.current += (target - smoothedRef.current) * 0.3;
    const level = smoothedRef.current;

    // Peak hold
    if (level > peakRef.current) {
      peakRef.current = level;
      peakDecayRef.current = 0;
    } else {
      peakDecayRef.current++;
      if (peakDecayRef.current > 30) { // ~0.5s hold
        peakRef.current *= 0.97;
      }
    }

    const maxVal = thresholds.mvc * 1.2;
    const reposoFrac = thresholds.reposo / maxVal;
    const leveFrac = thresholds.leve / maxVal;

    // Draw zones (bottom to top)
    const greenH = barH * reposoFrac;
    const yellowH = barH * (leveFrac - reposoFrac);
    const redH = barH * (1 - leveFrac);

    // Green zone
    ctx.fillStyle = "rgba(34, 197, 94, 0.12)";
    ctx.fillRect(barX, barBot - greenH, BAR_W, greenH);
    // Yellow zone
    ctx.fillStyle = "rgba(234, 179, 8, 0.12)";
    ctx.fillRect(barX, barBot - greenH - yellowH, BAR_W, yellowH);
    // Red zone
    ctx.fillStyle = "rgba(239, 68, 68, 0.12)";
    ctx.fillRect(barX, barTop, BAR_W, redH);

    // Zone separator lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(barX, barBot - greenH);
    ctx.lineTo(barX + BAR_W, barBot - greenH);
    ctx.moveTo(barX, barBot - greenH - yellowH);
    ctx.lineTo(barX + BAR_W, barBot - greenH - yellowH);
    ctx.stroke();
    ctx.setLineDash([]);

    // Fill level
    const fillFrac = Math.min(1, level / maxVal);
    const fillH = barH * fillFrac;
    const fillTop = barBot - fillH;

    // Gradient fill
    const grad = ctx.createLinearGradient(0, barBot, 0, barTop);
    grad.addColorStop(0, COLOR_GREEN);
    grad.addColorStop(reposoFrac, COLOR_GREEN);
    grad.addColorStop(reposoFrac + 0.01, COLOR_YELLOW);
    grad.addColorStop(leveFrac, COLOR_YELLOW);
    grad.addColorStop(leveFrac + 0.01, COLOR_RED);
    grad.addColorStop(1, COLOR_RED);

    ctx.fillStyle = grad;
    ctx.fillRect(barX, fillTop, BAR_W, fillH);

    // Glow at top of fill
    if (fillH > 2) {
      const glowGrad = ctx.createLinearGradient(0, fillTop, 0, fillTop + 6);
      glowGrad.addColorStop(0, "rgba(255, 255, 255, 0.3)");
      glowGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = glowGrad;
      ctx.fillRect(barX, fillTop, BAR_W, Math.min(6, fillH));
    }

    // Peak hold indicator
    const peakFrac = Math.min(1, peakRef.current / maxVal);
    const peakY = barBot - barH * peakFrac;
    if (peakFrac > 0.01) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(barX, peakY);
      ctx.lineTo(barX + BAR_W, peakY);
      ctx.stroke();
    }

    // Border
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barTop, BAR_W, barH);

    // Threshold labels (right side)
    const labX = barX + BAR_W + 3;
    ctx.fillStyle = theme.label;
    ctx.font = "7px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    ctx.fillStyle = COLOR_GREEN;
    ctx.fillText(`${thresholds.reposo.toFixed(2)}`, labX, barBot - greenH);
    ctx.fillStyle = COLOR_YELLOW;
    ctx.fillText(`${thresholds.leve.toFixed(1)}`, labX, barBot - greenH - yellowH);
    ctx.fillStyle = COLOR_RED;
    ctx.fillText(`${thresholds.mvc.toFixed(1)}`, labX, barTop + 4);

    // Current value at top
    ctx.fillStyle = level < thresholds.reposo ? COLOR_GREEN : level < thresholds.leve ? COLOR_YELLOW : COLOR_RED;
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(`${level.toFixed(2)}`, barX + BAR_W / 2, 2);

    // Unit label at bottom
    ctx.fillStyle = theme.label;
    ctx.font = "7px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("mV", barX + BAR_W / 2, totalH - 1);

    // Calibration overlay
    if (calibrationStep !== "idle" && calibrationStep !== "done") {
      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.fillRect(0, 0, totalW, totalH);

      const stepLabel = calibrationStep === "reposo" ? "REP" : calibrationStep === "leve" ? "LEV" : "MVC";
      const stepColor = calibrationStep === "reposo" ? COLOR_GREEN : calibrationStep === "leve" ? COLOR_YELLOW : COLOR_RED;

      ctx.fillStyle = stepColor;
      ctx.font = "bold 8px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(stepLabel, barX + BAR_W / 2, totalH / 2 - 8);

      // Progress bar
      const progW = BAR_W - 4;
      const progH = 4;
      const progX = barX + 2;
      const progY = totalH / 2 + 2;
      ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
      ctx.fillRect(progX, progY, progW, progH);
      ctx.fillStyle = stepColor;
      ctx.fillRect(progX, progY, progW * calibrationProgress, progH);

      ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      ctx.font = "7px monospace";
      ctx.fillText(`${Math.round(calibrationProgress * 100)}%`, barX + BAR_W / 2, progY + progH + 8);
    }

    rafRef.current = requestAnimationFrame(draw);
  }, [rmsValue, thresholds, calibrationStep, calibrationProgress, height]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: "block" }}
    />
  );
}
