import jsPDF from "jspdf";
import type { ReportConfig } from "@/stores/useReportStore";
import type { SpiroStudy } from "./types";
import {
  computeSpiroMetrics,
  averageMetrics,
  type SpiroGroupAverage,
} from "./metrics";
import { computeQuality, computeSuggestions, type QualityResult } from "./quality";

export interface SpiroChartImages {
  /** PNG dataURL del canvas Volumen/Tiempo */
  vt?: string;
  /** PNG dataURL del canvas Flujo/Volumen */
  fv?: string;
}

export interface SpiroPdfOptions {
  config: ReportConfig;
  /** Pares de imágenes de los gráficos para cada estado (PRE/POST).
   *  Si sólo se entrega `pre`, se grafica como única sección. */
  charts?: {
    pre?: SpiroChartImages;
    post?: SpiroChartImages;
  };
}

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 18;
const CONTENT_W = PAGE_W - MARGIN * 2;

const C = {
  title: [44, 62, 80] as [number, number, number],
  subtitle: [52, 73, 94] as [number, number, number],
  accent: [139, 92, 246] as [number, number, number],
  text: [55, 65, 81] as [number, number, number],
  muted: [107, 114, 128] as [number, number, number],
  rule: [229, 231, 235] as [number, number, number],
  headerBg: [243, 244, 246] as [number, number, number],
};

function setText(pdf: jsPDF, rgb: [number, number, number], size: number, bold = false) {
  pdf.setTextColor(rgb[0], rgb[1], rgb[2]);
  pdf.setFontSize(size);
  pdf.setFont("helvetica", bold ? "bold" : "normal");
}

function hr(pdf: jsPDF, y: number, color = C.rule) {
  pdf.setDrawColor(color[0], color[1], color[2]);
  pdf.setLineWidth(0.2);
  pdf.line(MARGIN, y, PAGE_W - MARGIN, y);
}

function ensureSpace(pdf: jsPDF, y: number, needed: number): number {
  if (y + needed > PAGE_H - MARGIN) {
    pdf.addPage();
    return MARGIN;
  }
  return y;
}

function fmt(v: number | null, digits = 2, suffix = ""): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits) + suffix;
}

function pctDelta(pre: number | null, post: number | null): string {
  if (pre === null || post === null || !Number.isFinite(pre) || !Number.isFinite(post) || pre === 0) {
    return "—";
  }
  return `${(((post - pre) / pre) * 100).toFixed(1)} %`;
}

function drawSectionTitle(pdf: jsPDF, y: number, title: string): number {
  y = ensureSpace(pdf, y, 10);
  setText(pdf, C.subtitle, 11, true);
  pdf.text(title, MARGIN, y);
  y += 1.5;
  hr(pdf, y, C.accent);
  return y + 4;
}

function drawPatientTable(pdf: jsPDF, y: number, s: SpiroStudy): number {
  y = drawSectionTitle(pdf, y, "Datos antropométricos");
  const heightM = s.patient.estaturaCm / 100;
  const imc = heightM > 0 ? s.patient.pesoKg / (heightM * heightM) : null;
  const imcStr = imc !== null && Number.isFinite(imc) ? `${imc.toFixed(1)} kg/m²` : "—";
  const rows: Array<[string, string, string, string]> = [
    ["Nombre", s.patient.nombre || "—", "RUT", s.patient.rut || "—"],
    ["Sexo", s.patient.sexo, "F. nacimiento", s.patient.fechaNacimiento || "—"],
    ["Edad", `${s.patient.edad} años`, "Etnia", s.patient.etnia],
    ["Estatura", `${s.patient.estaturaCm} cm`, "Peso", `${s.patient.pesoKg.toFixed(1)} kg`],
    ["IMC", imcStr, "", ""],
  ];
  const colW = CONTENT_W / 4;
  const rowH = 7;
  for (const row of rows) {
    y = ensureSpace(pdf, y, rowH);
    setText(pdf, C.muted, 8, false);
    pdf.text(row[0], MARGIN, y);
    setText(pdf, C.text, 10, false);
    pdf.text(row[1], MARGIN + colW * 0.45, y);
    setText(pdf, C.muted, 8, false);
    pdf.text(row[2], MARGIN + colW * 2, y);
    setText(pdf, C.text, 10, false);
    pdf.text(row[3], MARGIN + colW * 2.45, y);
    y += rowH;
  }
  if (s.patient.comentarios.trim()) {
    y = ensureSpace(pdf, y, 12);
    setText(pdf, C.muted, 8, false);
    pdf.text("Comentarios", MARGIN, y);
    y += 4;
    setText(pdf, C.text, 9, false);
    const lines = pdf.splitTextToSize(s.patient.comentarios, CONTENT_W);
    pdf.text(lines, MARGIN, y);
    y += lines.length * 4;
  }
  return y + 2;
}

/** Dibuja un par de imágenes (V/T y F/V) lado a lado bajo un header común.
 *  Cada subgráfica tiene su propio título. Si falta una imagen, dibuja
 *  sólo la otra ocupando el espacio. */
function drawChartPair(
  pdf: jsPDF,
  y: number,
  sectionLabel: string,
  images: SpiroChartImages,
): number {
  const { vt, fv } = images;
  if (!vt && !fv) return y;
  y = drawSectionTitle(pdf, y, sectionLabel);
  const gap = 4;
  const targetH = 65;
  const titleH = 5;
  // Reparto 60/40 V-t / F-V (aproximadamente igual a la app)
  const vtW = vt ? Math.floor((CONTENT_W - gap) * 0.6) : 0;
  const fvW = fv ? CONTENT_W - vtW - (vt ? gap : 0) : 0;
  y = ensureSpace(pdf, y, targetH + titleH + 4);

  setText(pdf, C.subtitle, 9, true);
  if (vt) pdf.text("Volumen / Tiempo", MARGIN + vtW / 2, y, { align: "center" });
  if (fv) pdf.text("Flujo / Volumen", MARGIN + vtW + (vt ? gap : 0) + fvW / 2, y, { align: "center" });
  y += titleH;

  try {
    if (vt) pdf.addImage(vt, "PNG", MARGIN, y, vtW, targetH);
  } catch {
    /* ignore */
  }
  try {
    if (fv) pdf.addImage(fv, "PNG", MARGIN + vtW + (vt ? gap : 0), y, fvW, targetH);
  } catch {
    /* ignore */
  }
  return y + targetH + 4;
}

function drawResultsTable(
  pdf: jsPDF,
  y: number,
  pre: SpiroGroupAverage | null,
  post: SpiroGroupAverage | null,
): number {
  y = drawSectionTitle(pdf, y, "Resultados");
  const cols = ["Parámetro", "PRE", "POST", "Δ %", "Unidad"];
  const colW = [CONTENT_W * 0.32, CONTENT_W * 0.18, CONTENT_W * 0.18, CONTENT_W * 0.18, CONTENT_W * 0.14];
  const rowH = 6.5;

  const drawRow = (cells: string[], header = false) => {
    if (header) {
      pdf.setFillColor(C.headerBg[0], C.headerBg[1], C.headerBg[2]);
      pdf.rect(MARGIN, y - 4.5, CONTENT_W, rowH, "F");
      setText(pdf, C.subtitle, 9, true);
    } else {
      setText(pdf, C.text, 9, false);
    }
    let x = MARGIN + 1.5;
    for (let i = 0; i < cells.length; i++) {
      pdf.text(cells[i], x, y);
      x += colW[i];
    }
    hr(pdf, y + 1.5);
    y += rowH;
  };

  y = ensureSpace(pdf, y, rowH * 9);
  drawRow(cols, true);

  const params: Array<[string, keyof SpiroGroupAverage, number, string]> = [
    ["PEF", "pef", 2, "L/s"],
    ["FVC", "fvc", 2, "L"],
    ["FEV1", "fev1", 2, "L"],
    ["FEV1/FVC (avg)", "fev1OverFvc", 1, "%"],
    ["Mejor FEV1/FVC", "bestFev1OverBestFvc", 1, "%"],
    ["FEF25", "fef25", 2, "L/s"],
    ["FEF50", "fef50", 2, "L/s"],
    ["FEF75", "fef75", 2, "L/s"],
    ["FIF25", "fif25", 2, "L/s"],
    ["FIF50", "fif50", 2, "L/s"],
    ["FIF75", "fif75", 2, "L/s"],
  ];
  for (const [label, key, digits, unit] of params) {
    const preV = (pre?.[key] as number | null | undefined) ?? null;
    const postV = (post?.[key] as number | null | undefined) ?? null;
    drawRow([label, fmt(preV, digits), fmt(postV, digits), pctDelta(preV, postV), unit]);
  }
  return y + 2;
}

function drawQuality(
  pdf: jsPDF,
  y: number,
  label: string,
  q: QualityResult,
  suggestions: Array<{
    removeRecordingNumber: number;
    newGrade: string;
    newRepeatabilityMl: number | null;
  }>,
): number {
  if (q.nManeuvers < 2) return y;
  y = ensureSpace(pdf, y, 14);
  setText(pdf, C.text, 10, true);
  pdf.text(`${label}: Grado ${q.grade}`, MARGIN, y);
  setText(pdf, C.muted, 9, false);
  pdf.text(
    `· n=${q.nManeuvers}` +
      (q.repeatabilityMl !== null ? `  · repetibilidad ${q.repeatabilityMl.toFixed(0)} ml` : "") +
      (q.nRejectedBev > 0 ? `  · ${q.nRejectedBev} rechazada(s) por BEV` : ""),
    MARGIN + 45,
    y,
  );
  y += 5;
  if (suggestions.length > 0) {
    setText(pdf, C.muted, 8, false);
    for (const s of suggestions) {
      y = ensureSpace(pdf, y, 5);
      pdf.text(
        `  → Quitar Prueba ${s.removeRecordingNumber} mejoraría a ${s.newGrade}` +
          (s.newRepeatabilityMl !== null ? ` (rep ${s.newRepeatabilityMl.toFixed(0)} ml)` : ""),
        MARGIN,
        y,
      );
      y += 4;
    }
  }
  return y + 1;
}

function drawTextBlock(pdf: jsPDF, y: number, title: string, body: string): number {
  if (!body.trim()) return y;
  y = drawSectionTitle(pdf, y, title);
  setText(pdf, C.text, 9.5, false);
  const lines = pdf.splitTextToSize(body, CONTENT_W);
  y = ensureSpace(pdf, y, lines.length * 4.6 + 2);
  pdf.text(lines, MARGIN, y);
  return y + lines.length * 4.6 + 2;
}

function drawHeader(pdf: jsPDF, study: SpiroStudy, config: ReportConfig): number {
  const headerH = 32;
  pdf.setFillColor(248, 250, 252);
  pdf.rect(0, 0, PAGE_W, headerH, "F");

  setText(pdf, C.accent, 16, true);
  pdf.text("REPORTE DE ESPIROMETRÍA", MARGIN, 14);

  setText(pdf, C.muted, 9, false);
  const fecha = new Date(study.timestamp).toLocaleString("es-CL", {
    dateStyle: "long",
    timeStyle: "short",
  });
  pdf.text(fecha, MARGIN, 21);

  if (config.clinicName) {
    setText(pdf, C.text, 10, true);
    pdf.text(config.clinicName, PAGE_W - MARGIN, 14, { align: "right" });
  }
  if (config.clinicAddress || config.clinicPhone) {
    setText(pdf, C.muted, 8, false);
    const line = [config.clinicAddress, config.clinicPhone].filter(Boolean).join(" · ");
    pdf.text(line, PAGE_W - MARGIN, 19, { align: "right" });
  }
  if (config.professionalName) {
    setText(pdf, C.muted, 8, false);
    const line = [
      config.professionalName,
      config.professionalTitle,
      config.professionalLicense ? `Col. ${config.professionalLicense}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    pdf.text(line, PAGE_W - MARGIN, 24, { align: "right" });
  }

  hr(pdf, headerH - 2, C.accent);
  return headerH + 2;
}

function drawFooter(pdf: jsPDF) {
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    setText(pdf, C.muted, 7, false);
    pdf.text(`Página ${i} de ${pages}`, PAGE_W - MARGIN, PAGE_H - 6, { align: "right" });
    pdf.text("fisioaccess_espiro", MARGIN, PAGE_H - 6);
  }
}

export function generateSpiroPDF(
  study: SpiroStudy,
  options: SpiroPdfOptions,
): jsPDF {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let y = drawHeader(pdf, study, options.config);

  y = drawPatientTable(pdf, y, study);

  // Agrupar maniobras por estado
  const preRecs = study.recordings.filter((r) => r.bronchodilatorStatus === "PRE");
  const postRecs = study.recordings.filter((r) => r.bronchodilatorStatus === "POST");
  const lp = study.linePositions;
  const firstLp = Object.values(lp)[0] ?? { markerA: 1, markerB: 2, refPef: 1.5, refFvc: 4 };
  const a = firstLp.markerA;
  const b = firstLp.markerB;

  const preMetrics = preRecs
    .map((r) => computeSpiroMetrics(r.data, a, b))
    .filter((m): m is NonNullable<typeof m> => m !== null);
  const postMetrics = postRecs
    .map((r) => computeSpiroMetrics(r.data, a, b))
    .filter((m): m is NonNullable<typeof m> => m !== null);
  const preAvg = preMetrics.length > 0 ? averageMetrics(preMetrics) : null;
  const postAvg = postMetrics.length > 0 ? averageMetrics(postMetrics) : null;

  const preCharts = options.charts?.pre;
  const postCharts = options.charts?.post;
  if (preCharts && (preCharts.vt || preCharts.fv)) {
    y = drawChartPair(pdf, y, "Curvas PRE bronco-dilatador", preCharts);
  }
  if (postCharts && (postCharts.vt || postCharts.fv)) {
    y = drawChartPair(pdf, y, "Curvas POST bronco-dilatador", postCharts);
  }

  y = drawResultsTable(pdf, y, preAvg, postAvg);

  // Calidad
  const preQuality = computeQuality(preMetrics);
  const postQuality = computeQuality(postMetrics);
  const preSugs = computeSuggestions(preMetrics, preRecs.map((r) => r.recordingNumber));
  const postSugs = computeSuggestions(postMetrics, postRecs.map((r) => r.recordingNumber));
  if (preQuality.nManeuvers >= 2 || postQuality.nManeuvers >= 2) {
    y = drawSectionTitle(pdf, y, "Calidad ATS/ERS");
    y = drawQuality(pdf, y, "PRE", preQuality, preSugs);
    y = drawQuality(pdf, y, "POST", postQuality, postSugs);
  }

  y = drawTextBlock(pdf, y, "Interpretación", study.analysis.interpretacion);
  y = drawTextBlock(pdf, y, "Conclusión", study.analysis.conclusion);

  drawFooter(pdf);
  return pdf;
}
