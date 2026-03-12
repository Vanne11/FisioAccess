import type { ECGDataPoint } from "@/components/shared/ECGCanvas";
import type { ECGMarker, QRSComplex } from "@/lib/markers";
import { MARKER_COLORS, QRS_COLOR } from "@/lib/markers";
import type { RPeak } from "@/lib/peaks";
import type { CalibrationConfig } from "@/utils/signalCalibrator";
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
  markers: ECGMarker[];
  qrsComplexes: QRSComplex[];
  rPeaks: RPeak[];
  bpm: number;
  sampleRate: number;
  calibration: CalibrationConfig;
  includeMarkers: boolean;
}

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

function drawInfoPanel(
  ctx: CanvasRenderingContext2D,
  opts: ExportOptions,
  canvasW: number,
  totalDataMs: number,
) {
  const { markers, qrsComplexes, rPeaks, bpm, sampleRate, sweepSpeed, data } = opts;

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
  lines.push({ label: "Escala Y", value: "Auto" });

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
    markers,
    qrsComplexes,
    rPeaks,
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

  // --- Auto-escala Y: min/max de todos los datos ---
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const pt of data) {
    if (pt.value < yMin) yMin = pt.value;
    if (pt.value > yMax) yMax = pt.value;
  }
  if (!isFinite(yMin) || !isFinite(yMax) || yMin === yMax) {
    yMin = -1;
    yMax = 1;
  }
  const yRange = yMax - yMin;
  const yMargin = yRange * 0.1;
  yMin -= yMargin;
  yMax += yMargin;

  const valueToY = (v: number) => canvasH - ((v - yMin) / (yMax - yMin)) * canvasH;

  const startTs = data[0].timestamp_ms;
  const endTs = data[data.length - 1].timestamp_ms;
  const tsToX = (ts: number) => MARGIN_LEFT + (ts - startTs) * pxPerMs;

  // Grid intervals
  const smallMs = 1000 / sweepSpeed;
  const largeMs = smallMs * 5;
  const { small: smallMv, large: largeMv } = niceGridInterval(yMax - yMin);

  // Fondo blanco
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Cuadricula horizontal (voltaje, auto-escala)
  if (smallMv > 0) {
    ctx.strokeStyle = COLOR_SMALL_GRID;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    const firstSmallMv = Math.ceil(yMin / smallMv) * smallMv;
    for (let mv = firstSmallMv; mv <= yMax; mv += smallMv) {
      const y = valueToY(mv);
      ctx.moveTo(0, y); ctx.lineTo(canvasW, y);
    }
    ctx.stroke();

    ctx.strokeStyle = COLOR_LARGE_GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const firstLargeMv = Math.ceil(yMin / largeMv) * largeMv;
    for (let mv = firstLargeMv; mv <= yMax; mv += largeMv) {
      const y = valueToY(mv);
      ctx.moveTo(0, y); ctx.lineTo(canvasW, y);
    }
    ctx.stroke();
  }

  // Cuadricula vertical (tiempo, alineada)
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

  // Etiquetas eje Y (valores reales)
  if (largeMv > 0) {
    ctx.fillStyle = "#64748b";
    ctx.font = "11px monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const firstLargeMv = Math.ceil(yMin / largeMv) * largeMv;
    for (let mv = firstLargeMv; mv <= yMax; mv += largeMv) {
      const y = valueToY(mv);
      if (y < 8 || y > canvasH - 8) continue;
      ctx.fillText(Math.abs(mv) < 0.001 ? "0" : mv.toFixed(2), MARGIN_LEFT - 4, y);
    }
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

  // Detectar gaps temporales (pausas)
  const gapThreshold = 500;
  const gaps: { x1: number; x2: number; durationMs: number }[] = [];
  for (let i = 1; i < data.length; i++) {
    const dt = data[i].timestamp_ms - data[i - 1].timestamp_ms;
    if (dt > gapThreshold) {
      gaps.push({
        x1: tsToX(data[i - 1].timestamp_ms),
        x2: tsToX(data[i].timestamp_ms),
        durationMs: dt,
      });
    }
  }

  // Trazo ECG
  ctx.save();
  ctx.beginPath();
  ctx.rect(MARGIN_LEFT, 0, canvasW - MARGIN_LEFT, canvasH);
  ctx.clip();

  // Indicadores de gap
  for (const gap of gaps) {
    const gx1 = Math.max(MARGIN_LEFT, gap.x1);
    const gx2 = Math.min(canvasW, gap.x2);
    ctx.fillStyle = "rgba(100, 116, 139, 0.06)";
    ctx.fillRect(gx1, 0, gx2 - gx1, canvasH);
    ctx.strokeStyle = "rgba(100, 116, 139, 0.25)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(gx1, 0); ctx.lineTo(gx1, canvasH);
    ctx.moveTo(gx2, 0); ctx.lineTo(gx2, canvasH);
    ctx.stroke();
    ctx.setLineDash([]);
    if (gx2 - gx1 > 30) {
      const durLabel = gap.durationMs >= 1000
        ? `${(gap.durationMs / 1000).toFixed(1)}s`
        : `${gap.durationMs.toFixed(0)}ms`;
      ctx.fillStyle = "rgba(100, 116, 139, 0.5)";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`PAUSA ${durLabel}`, (gx1 + gx2) / 2, canvasH / 2);
    }
  }

  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();

  let started = false;
  let prevTs = -1;
  for (const pt of data) {
    const x = tsToX(pt.timestamp_ms);
    const y = valueToY(pt.value);
    const isGap = prevTs >= 0 && pt.timestamp_ms - prevTs > gapThreshold;
    if (!started || isGap) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
    prevTs = pt.timestamp_ms;
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
  ctx.fillText(`${sweepSpeed} mm/s | Auto-escala | ${data.length} muestras`, MARGIN_LEFT, canvasH - 2);

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
