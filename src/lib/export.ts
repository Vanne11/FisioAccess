import type { ECGDataPoint } from "@/components/shared/ECGCanvas";
import type { ECGMarker, QRSComplex } from "@/lib/markers";
import { MARKER_COLORS, QRS_COLOR } from "@/lib/markers";
import type { RPeak } from "@/lib/peaks";
import { createECGScale } from "@/utils/ecgScale";
import { toMillivolts, type CalibrationConfig, DEFAULT_CALIBRATION } from "@/utils/signalCalibrator";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

const BASE_PX_PER_MM = 4;
const MAX_CANVAS_WIDTH = 16000;
const MARGIN_LEFT = 40;

const COLOR_SMALL_GRID = "rgba(200, 50, 50, 0.15)";
const COLOR_LARGE_GRID = "rgba(200, 50, 50, 0.35)";
const COLOR_RPEAK_DOT = "rgba(239, 68, 68, 0.6)";

interface ExportOptions {
  data: ECGDataPoint[];
  sweepSpeed: number;
  gain: number;
  markers: ECGMarker[];
  qrsComplexes: QRSComplex[];
  rPeaks: RPeak[];
  bpm: number;
  sampleRate: number;
  calibration: CalibrationConfig;
  includeMarkers: boolean;
}

function drawInfoPanel(
  ctx: CanvasRenderingContext2D,
  opts: ExportOptions,
  canvasW: number,
  totalDataMs: number,
) {
  const { markers, qrsComplexes, rPeaks, bpm, sampleRate, sweepSpeed, gain, data } = opts;

  const panelW = 220;
  const lineH = 15;
  const pad = 10;
  const headerH = 22;

  const lines: { label: string; value: string; color?: string }[] = [];

  lines.push({ label: "BPM", value: bpm > 0 ? bpm.toFixed(0) : "--", color: "#ef4444" });

  const durSec = totalDataMs / 1000;
  const durMin = Math.floor(durSec / 60);
  const durS = Math.floor(durSec % 60);
  lines.push({ label: "Duracion", value: `${durMin}:${String(durS).padStart(2, "0")}` });
  lines.push({ label: "Muestras", value: String(data.length) });
  lines.push({ label: "Fs", value: sampleRate > 0 ? `${sampleRate.toFixed(0)} Hz` : "--" });
  lines.push({ label: "Velocidad", value: `${sweepSpeed} mm/s` });
  lines.push({ label: "Ganancia", value: `${gain} mm/mV` });

  if (rPeaks.length > 0) {
    lines.push({ label: "R-peaks", value: String(rPeaks.length), color: "#ef4444" });
  }

  const pointMarkers = markers.filter((m) => m.kind === "point");
  const intervalMarkers = markers.filter((m) => m.kind === "interval");

  if (pointMarkers.length > 0) {
    lines.push({ label: "--- Ondas ---", value: "" });
    for (const m of pointMarkers) {
      if (m.kind !== "point") continue;
      const t = ((m.timestamp_ms - data[0].timestamp_ms) / 1000).toFixed(2);
      lines.push({ label: m.type, value: `${t}s`, color: MARKER_COLORS[m.type] });
    }
  }

  if (intervalMarkers.length > 0) {
    lines.push({ label: "--- Intervalos ---", value: "" });
    for (const m of intervalMarkers) {
      if (m.kind !== "interval") continue;
      const dur = m.endMs - m.startMs;
      lines.push({ label: m.type, value: `${dur.toFixed(0)} ms`, color: MARKER_COLORS[m.type] });
    }
  }

  if (qrsComplexes.length > 0) {
    lines.push({ label: "--- QRS ---", value: "" });
    for (let i = 0; i < qrsComplexes.length; i++) {
      const qrs = qrsComplexes[i];
      lines.push({
        label: `QRS #${i + 1}`,
        value: `${qrs.durationMs.toFixed(0)} ms`,
        color: QRS_COLOR,
      });
    }
  }

  const panelH = headerH + pad * 2 + lines.length * lineH + 4;
  const px = canvasW - panelW - 12;
  const py = 12;

  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(px, py, panelW, panelH, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#1e293b";
  ctx.beginPath();
  ctx.roundRect(px, py, panelW, headerH, [6, 6, 0, 0]);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 12px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("INFORME ECG", px + panelW / 2, py + headerH / 2);

  const now = new Date();
  const dateStr = `${now.getDate().toString().padStart(2, "0")}/${(now.getMonth() + 1).toString().padStart(2, "0")}/${now.getFullYear()} ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  ctx.fillStyle = "#64748b";
  ctx.font = "9px monospace";
  ctx.textAlign = "left";
  ctx.fillText(dateStr, px + pad, py + headerH + pad);

  let curY = py + headerH + pad + lineH;
  ctx.textBaseline = "middle";

  for (const line of lines) {
    if (line.label.startsWith("---")) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(line.label.replace(/---/g, "").trim(), px + panelW / 2, curY);
      curY += lineH;
      continue;
    }

    ctx.fillStyle = line.color || "#334155";
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "left";
    ctx.fillText(line.label, px + pad, curY);

    ctx.fillStyle = line.color || "#1e293b";
    ctx.font = "11px monospace";
    ctx.textAlign = "right";
    ctx.fillText(line.value, px + panelW - pad, curY);

    curY += lineH;
  }
}

function renderECGToCanvas(opts: ExportOptions): HTMLCanvasElement {
  const {
    data,
    sweepSpeed,
    gain,
    markers,
    qrsComplexes,
    rPeaks,
    calibration,
    includeMarkers,
  } = opts;

  if (data.length < 2) throw new Error("No hay datos para exportar");

  const totalDataMs = data[data.length - 1].timestamp_ms - data[0].timestamp_ms;
  const idealPxPerMs = (BASE_PX_PER_MM * sweepSpeed) / 1000;
  const idealW = MARGIN_LEFT + totalDataMs * idealPxPerMs;
  const pxPerMm = idealW > MAX_CANVAS_WIDTH
    ? ((MAX_CANVAS_WIDTH - MARGIN_LEFT) / totalDataMs) * (1000 / sweepSpeed)
    : BASE_PX_PER_MM;
  const pxPerMs = (pxPerMm * sweepSpeed) / 1000;
  const canvasW = Math.min(MAX_CANVAS_WIDTH, Math.ceil(MARGIN_LEFT + totalDataMs * pxPerMs));
  const canvasH = 800;

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d")!;

  const pxPerMv = pxPerMm * gain;
  const baselineY = canvasH / 2;
  const rawToMv = (raw: number) => toMillivolts(raw, calibration);
  const mvToY = (mv: number) => baselineY - mv * pxPerMv;
  const valueToY = (raw: number) => mvToY(rawToMv(raw));

  const startTs = data[0].timestamp_ms;
  const tsToX = (ts: number) => MARGIN_LEFT + (ts - startTs) * pxPerMs;

  // Intervalos de cuadricula
  const smallMv = 1 / gain;
  const largeMv = smallMv * 5;
  const smallMs = 1000 / sweepSpeed;
  const largeMs = smallMs * 5;

  // Fondo blanco
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Cuadricula horizontal (voltaje, alineada a 0mV)
  const topMv = (baselineY) / pxPerMv;
  const bottomMv = -(canvasH - baselineY) / pxPerMv;

  ctx.strokeStyle = COLOR_SMALL_GRID;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  const firstSmallMv = Math.ceil(bottomMv / smallMv) * smallMv;
  for (let mv = firstSmallMv; mv <= topMv; mv += smallMv) {
    const y = mvToY(mv);
    ctx.moveTo(0, y); ctx.lineTo(canvasW, y);
  }
  ctx.stroke();

  ctx.strokeStyle = COLOR_LARGE_GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const firstLargeMv = Math.ceil(bottomMv / largeMv) * largeMv;
  for (let mv = firstLargeMv; mv <= topMv; mv += largeMv) {
    const y = mvToY(mv);
    ctx.moveTo(0, y); ctx.lineTo(canvasW, y);
  }
  ctx.stroke();

  // Cuadricula vertical (tiempo, alineada)
  const endTs = data[data.length - 1].timestamp_ms;

  ctx.strokeStyle = COLOR_SMALL_GRID;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  const firstSmallT = Math.ceil(startTs / smallMs) * smallMs;
  for (let t = firstSmallT; t <= endTs; t += smallMs) {
    const x = tsToX(t);
    if (x < MARGIN_LEFT) continue;
    ctx.moveTo(x, 0); ctx.lineTo(x, canvasH);
  }
  ctx.stroke();

  ctx.strokeStyle = COLOR_LARGE_GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const firstLargeT = Math.ceil(startTs / largeMs) * largeMs;
  for (let t = firstLargeT; t <= endTs; t += largeMs) {
    const x = tsToX(t);
    if (x < MARGIN_LEFT) continue;
    ctx.moveTo(x, 0); ctx.lineTo(x, canvasH);
  }
  ctx.stroke();

  // Etiquetas eje Y
  ctx.fillStyle = "#64748b";
  ctx.font = "11px monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let mv = firstLargeMv; mv <= topMv; mv += largeMv) {
    const y = mvToY(mv);
    if (y < 8 || y > canvasH - 8) continue;
    ctx.fillText(Math.abs(mv) < 0.001 ? "0" : mv.toFixed(1), MARGIN_LEFT - 4, y);
  }

  // Etiquetas eje X
  ctx.fillStyle = "#64748b";
  ctx.font = "9px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const labelInterval = largeMs * 5;
  const firstLabel = Math.ceil(startTs / labelInterval) * labelInterval;
  for (let t = firstLabel; t <= endTs; t += labelInterval) {
    const x = tsToX(t);
    if (x < MARGIN_LEFT || x > canvasW - 10) continue;
    ctx.fillText(`${((t - startTs) / 1000).toFixed(0)}s`, x, canvasH - 14);
  }

  // Barra de calibracion 1mV
  const bar1mvH = pxPerMv;
  if (bar1mvH > 4 && bar1mvH < canvasH * 0.8) {
    const barX = 8;
    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(barX, baselineY + bar1mvH / 2);
    ctx.lineTo(barX, baselineY - bar1mvH / 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(barX - 3, baselineY + bar1mvH / 2);
    ctx.lineTo(barX + 3, baselineY + bar1mvH / 2);
    ctx.moveTo(barX - 3, baselineY - bar1mvH / 2);
    ctx.lineTo(barX + 3, baselineY - bar1mvH / 2);
    ctx.stroke();
    ctx.fillStyle = "#64748b";
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("1mV", barX, baselineY);
  }

  // Marcadores de intervalo (fondo)
  if (includeMarkers) {
    for (const m of markers) {
      if (m.kind !== "interval") continue;
      const x1 = tsToX(m.startMs);
      const x2 = tsToX(m.endMs);
      ctx.fillStyle = MARKER_COLORS[m.type] + "20";
      ctx.fillRect(Math.max(MARGIN_LEFT, x1), 0, Math.min(canvasW, x2) - Math.max(MARGIN_LEFT, x1), canvasH);
    }
  }

  // Trazo ECG
  ctx.save();
  ctx.beginPath();
  ctx.rect(MARGIN_LEFT, 0, canvasW - MARGIN_LEFT, canvasH);
  ctx.clip();

  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();

  let started = false;
  for (const pt of data) {
    const x = tsToX(pt.timestamp_ms);
    const y = valueToY(pt.value);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  if (includeMarkers) {
    for (const pk of rPeaks) {
      const x = tsToX(pk.timestamp_ms);
      const y = valueToY(pk.value);
      ctx.fillStyle = COLOR_RPEAK_DOT;
      ctx.beginPath();
      ctx.arc(x, y - 6, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const m of markers) {
      if (m.kind !== "point") continue;
      const x = tsToX(m.timestamp_ms);
      const color = MARKER_COLORS[m.type];

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasH);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = color;
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.fillText(m.type, x, 16);
    }

    for (const m of markers) {
      if (m.kind !== "interval") continue;
      const x1 = tsToX(m.startMs);
      const x2 = tsToX(m.endMs);
      const color = MARKER_COLORS[m.type];
      const durMs = m.endMs - m.startMs;

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.7;
      for (const bx of [x1, x2]) {
        ctx.beginPath();
        ctx.setLineDash([3, 3]);
        ctx.moveTo(bx, 0);
        ctx.lineTo(bx, canvasH);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      const mx = (x1 + x2) / 2;
      ctx.fillStyle = color;
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${m.type} ${durMs.toFixed(0)}ms`, mx, canvasH - 30);
    }

    for (let qi = 0; qi < qrsComplexes.length; qi++) {
      const qrs = qrsComplexes[qi];
      const xq = tsToX(qrs.qMs);
      const xs = tsToX(qrs.sMs);

      ctx.fillStyle = QRS_COLOR + "15";
      ctx.fillRect(Math.max(MARGIN_LEFT, xq), 0, Math.min(canvasW, xs) - Math.max(MARGIN_LEFT, xq), canvasH);

      const bracketY = 30;
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
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`QRS ${qrs.durationMs.toFixed(0)}ms`, mx, bracketY - 4);
    }
  }

  ctx.restore();

  // Info bar inferior
  ctx.fillStyle = "#64748b";
  ctx.font = "10px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`${sweepSpeed} mm/s | ${gain} mm/mV | ${data.length} muestras`, MARGIN_LEFT, canvasH - 2);

  if (includeMarkers) {
    drawInfoPanel(ctx, opts, canvasW, totalDataMs);
  }

  return canvas;
}

export async function exportECGAsPNG(opts: ExportOptions): Promise<string | null> {
  const canvas = renderECGToCanvas(opts);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Error al generar imagen");

  const suffix = opts.includeMarkers ? "marcas" : "limpio";
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const defaultName = `ECG_${dateStr}_${suffix}.png`;

  const filePath = await save({
    defaultPath: defaultName,
    filters: [{ name: "PNG", extensions: ["png"] }],
  });

  if (!filePath) return null;

  const arrayBuffer = await blob.arrayBuffer();
  await writeFile(filePath, new Uint8Array(arrayBuffer));

  return filePath;
}
