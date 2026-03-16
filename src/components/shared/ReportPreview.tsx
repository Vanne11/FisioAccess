import { useState, useRef } from "react";
import { X, Download, FileText } from "lucide-react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { useReportStore, type ReportConfig } from "@/stores/useReportStore";

/* ------------------------------------------------------------------ */
/*  Tipos                                                              */
/* ------------------------------------------------------------------ */

export interface PatientData {
  name: string;
  age: string;
  id: string;
  notes: string;
}

export interface ReportField {
  label: string;
  value: string;
  unit?: string;
}

export interface PhaseReportEntry {
  label: string;
  color: string;
  durationSec: number;
  rms: number;
  peakToPeak: number;
  peakPositive: number;
  peakNegative: number;
}

export interface ReportData {
  title: string;
  accent: string;
  fields: ReportField[];
  signalImage?: string;
  signalLabel?: string;
  observations?: string;
  /** Phase stats for EMG protocol reports */
  phases?: PhaseReportEntry[];
}

interface ReportPreviewProps {
  open: boolean;
  onClose: () => void;
  report: ReportData;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function today() {
  return new Date().toLocaleDateString("es-ES", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Captura un <canvas> como data URL PNG */
export function captureCanvas(container: HTMLElement | null): string {
  if (!container) return "";
  const canvas = container.querySelector("canvas");
  if (!canvas) return "";
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

/** Captura un <svg> dentro de un contenedor como data URL PNG */
export function captureSVG(container: HTMLElement | null): Promise<string> {
  if (!container) return Promise.resolve("");
  const svg = container.querySelector("svg");
  if (!svg) return Promise.resolve("");

  return new Promise((resolve) => {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    clone.setAttribute("width", String(rect.width));
    clone.setAttribute("height", String(rect.height));

    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width", "100%");
    bg.setAttribute("height", "100%");
    bg.setAttribute("fill", "white");
    clone.insertBefore(bg, clone.firstChild);

    clone.querySelectorAll("text").forEach((t) => {
      t.setAttribute("fill", "#374151");
    });
    clone.querySelectorAll("line").forEach((l) => {
      const stroke = l.getAttribute("stroke") || "";
      if (stroke.includes("rgba(255,255,255")) {
        l.setAttribute("stroke", "rgba(0,0,0,0.08)");
      }
    });

    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(clone);
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      const scale = 2;
      c.width = rect.width * scale;
      c.height = rect.height * scale;
      const ctx = c.getContext("2d")!;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, rect.width, rect.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve("");
    };
    img.src = url;
  });
}

/* ------------------------------------------------------------------ */
/*  Formulario de paciente                                             */
/* ------------------------------------------------------------------ */

function PatientForm({
  patient,
  onChange,
}: {
  patient: PatientData;
  onChange: (p: PatientData) => void;
}) {
  const field = (label: string, key: keyof PatientData, placeholder: string) => (
    <div key={key}>
      <label className="block text-[10px] text-secondary mb-1">{label}</label>
      <input
        value={patient[key]}
        onChange={(e) => onChange({ ...patient, [key]: e.target.value })}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-surface-800/50 text-xs text-primary placeholder:text-muted focus:outline-none focus:border-ecg-500/50 transition-colors"
      />
    </div>
  );

  return (
    <div className="grid grid-cols-3 gap-3">
      {field("Nombre del paciente", "name", "Nombre completo")}
      {field("Edad", "age", "Ej: 45")}
      {field("Identificación", "id", "DNI / Cédula")}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Página del informe (inline styles para que html2canvas los vea)    */
/* ------------------------------------------------------------------ */

function ReportPage({
  config,
  patient,
  report,
}: {
  config: ReportConfig;
  patient: PatientData;
  report: ReportData;
}) {
  return (
    <div
      style={{
        background: "white",
        color: "#111827",
        width: "794px", // A4 a 96dpi
        minHeight: "1123px",
        margin: "0 auto",
        boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ padding: "60px 75px" }}>
        {/* ---- Cabecera ---- */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            borderBottom: `2px solid ${report.accent}`,
            paddingBottom: "16px",
            marginBottom: "24px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            {config.clinicLogo && (
              <img
                src={config.clinicLogo}
                alt="Logo"
                style={{ height: "56px", width: "56px", objectFit: "contain" }}
              />
            )}
            <div>
              <h1 style={{ fontSize: "18px", fontWeight: 700, color: report.accent, margin: 0 }}>
                {config.clinicName || "Centro sin configurar"}
              </h1>
              {config.clinicAddress && (
                <p style={{ fontSize: "12px", color: "#6b7280", margin: "2px 0 0" }}>
                  {config.clinicAddress}
                </p>
              )}
              <div style={{ display: "flex", gap: "16px", fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>
                {config.clinicPhone && <span>{config.clinicPhone}</span>}
                {config.clinicEmail && <span>{config.clinicEmail}</span>}
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: "12px", color: "#6b7280" }}>
            <p style={{ margin: 0 }}>{today()}</p>
            <p style={{ fontWeight: 500, color: "#374151", marginTop: "4px" }}>
              INFORME DE {report.title.toUpperCase()}
            </p>
          </div>
        </div>

        {/* ---- Datos del paciente ---- */}
        <div
          style={{
            marginBottom: "24px",
            borderRadius: "8px",
            border: "1px solid #e5e7eb",
            padding: "16px",
          }}
        >
          <h2 style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
            Datos del paciente
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", fontSize: "14px" }}>
            <div>
              <span style={{ fontSize: "12px", color: "#9ca3af" }}>Nombre</span>
              <p style={{ fontWeight: 500, margin: "2px 0 0" }}>{patient.name || "\u2014"}</p>
            </div>
            <div>
              <span style={{ fontSize: "12px", color: "#9ca3af" }}>Edad</span>
              <p style={{ fontWeight: 500, margin: "2px 0 0" }}>{patient.age ? `${patient.age} años` : "\u2014"}</p>
            </div>
            <div>
              <span style={{ fontSize: "12px", color: "#9ca3af" }}>Identificación</span>
              <p style={{ fontWeight: 500, margin: "2px 0 0" }}>{patient.id || "\u2014"}</p>
            </div>
          </div>
        </div>

        {/* ---- Gráfico de la señal ---- */}
        {report.signalImage && (
          <div style={{ marginBottom: "24px" }}>
            <h2 style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
              {report.signalLabel || "Registro de señal"}
            </h2>
            <div
              style={{
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
                padding: "8px",
                background: "#f9fafb",
              }}
            >
              <img
                src={report.signalImage}
                alt={report.signalLabel || "Señal"}
                style={{ width: "100%", height: "auto", borderRadius: "4px", display: "block" }}
              />
            </div>
          </div>
        )}

        {/* ---- Resultados ---- */}
        <div style={{ marginBottom: "24px" }}>
          <h2 style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
            Resultados
          </h2>
          <table style={{ width: "100%", fontSize: "14px", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ textAlign: "left", padding: "8px 0", fontSize: "12px", fontWeight: 600, color: "#6b7280", width: "50%" }}>
                  Parámetro
                </th>
                <th style={{ textAlign: "left", padding: "8px 0", fontSize: "12px", fontWeight: 600, color: "#6b7280" }}>
                  Valor
                </th>
                <th style={{ textAlign: "left", padding: "8px 0", fontSize: "12px", fontWeight: 600, color: "#6b7280" }}>
                  Unidad
                </th>
              </tr>
            </thead>
            <tbody>
              {report.fields.map((f, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "8px 0", color: "#374151" }}>{f.label}</td>
                  <td style={{ padding: "8px 0", fontFamily: "monospace", fontWeight: 500 }}>{f.value}</td>
                  <td style={{ padding: "8px 0", color: "#9ca3af" }}>{f.unit || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ---- Fases del protocolo ---- */}
        {report.phases && report.phases.length > 0 && (
          <div style={{ marginBottom: "24px" }}>
            <h2 style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
              Analisis por fases
            </h2>
            <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                  <th style={{ textAlign: "left", padding: "8px 6px", fontSize: "11px", fontWeight: 600, color: "#6b7280" }}>Fase</th>
                  <th style={{ textAlign: "right", padding: "8px 6px", fontSize: "11px", fontWeight: 600, color: "#6b7280" }}>Duración</th>
                  <th style={{ textAlign: "right", padding: "8px 6px", fontSize: "11px", fontWeight: 600, color: "#6b7280" }}>RMS (uV)</th>
                  <th style={{ textAlign: "right", padding: "8px 6px", fontSize: "11px", fontWeight: 600, color: "#6b7280" }}>P-P (uV)</th>
                  <th style={{ textAlign: "right", padding: "8px 6px", fontSize: "11px", fontWeight: 600, color: "#6b7280" }}>Pico+ (uV)</th>
                  <th style={{ textAlign: "right", padding: "8px 6px", fontSize: "11px", fontWeight: 600, color: "#6b7280" }}>Pico- (uV)</th>
                </tr>
              </thead>
              <tbody>
                {report.phases.map((ph, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "8px 6px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: ph.color, display: "inline-block", flexShrink: 0 }} />
                        <span style={{ fontWeight: 500, color: "#374151" }}>{ph.label}</span>
                      </span>
                    </td>
                    <td style={{ padding: "8px 6px", textAlign: "right", fontFamily: "monospace", color: "#374151" }}>
                      {ph.durationSec >= 1 ? `${ph.durationSec.toFixed(1)}s` : `${(ph.durationSec * 1000).toFixed(0)}ms`}
                    </td>
                    <td style={{ padding: "8px 6px", textAlign: "right", fontFamily: "monospace", fontWeight: 500, color: "#374151" }}>
                      {ph.rms.toFixed(1)}
                    </td>
                    <td style={{ padding: "8px 6px", textAlign: "right", fontFamily: "monospace", fontWeight: 500, color: "#374151" }}>
                      {ph.peakToPeak.toFixed(1)}
                    </td>
                    <td style={{ padding: "8px 6px", textAlign: "right", fontFamily: "monospace", color: "#6b7280" }}>
                      {ph.peakPositive.toFixed(1)}
                    </td>
                    <td style={{ padding: "8px 6px", textAlign: "right", fontFamily: "monospace", color: "#6b7280" }}>
                      {ph.peakNegative.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ---- Observaciones ---- */}
        <div style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
            Observaciones
          </h2>
          <div
            style={{
              minHeight: "60px",
              borderRadius: "8px",
              border: "1px solid #e5e7eb",
              padding: "12px",
              fontSize: "14px",
              color: "#4b5563",
            }}
          >
            {report.observations || patient.notes || "Sin observaciones"}
          </div>
        </div>

        {/* ---- Firma ---- */}
        <div style={{ paddingTop: "40px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ width: "192px", borderTop: "1px solid #9ca3af", paddingTop: "8px" }}>
              <p style={{ fontSize: "14px", fontWeight: 500, margin: 0 }}>
                {config.professionalName || "Profesional"}
              </p>
              {config.professionalTitle && (
                <p style={{ fontSize: "12px", color: "#6b7280", margin: "2px 0 0" }}>{config.professionalTitle}</p>
              )}
              {config.professionalLicense && (
                <p style={{ fontSize: "12px", color: "#9ca3af", margin: "2px 0 0" }}>
                  Col. {config.professionalLicense}
                </p>
              )}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ width: "192px", borderTop: "1px solid #9ca3af", paddingTop: "8px" }}>
              <p style={{ fontSize: "14px", color: "#6b7280", margin: 0 }}>Firma del paciente</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Modal principal                                                    */
/* ------------------------------------------------------------------ */

export function ReportPreview({ open, onClose, report }: ReportPreviewProps) {
  const { config } = useReportStore();
  const [patient, setPatient] = useState<PatientData>({
    name: "",
    age: "",
    id: "",
    notes: "",
  });
  const printRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  if (!open) return null;

  const handleExportPDF = async () => {
    if (!printRef.current || exporting) return;
    setExporting(true);

    try {
      // Capturar el contenido renderizado como imagen
      const canvas = await html2canvas(printRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });

      // Crear PDF tamaño A4
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = 210;
      const pageH = 297;

      // Calcular dimensiones de la imagen en el PDF
      const imgW = pageW;
      const imgH = (canvas.height / canvas.width) * imgW;

      // Si la imagen es mas alta que una pagina, paginar
      let yOffset = 0;
      while (yOffset < imgH) {
        if (yOffset > 0) pdf.addPage();
        pdf.addImage(
          canvas.toDataURL("image/png"),
          "PNG",
          0,
          -yOffset,
          imgW,
          imgH,
        );
        yOffset += pageH;
      }

      // Diálogo de guardar nativo de Tauri
      const filePath = await save({
        title: "Guardar informe PDF",
        defaultPath: `Informe_${report.title.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.pdf`,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (filePath) {
        const pdfBytes = pdf.output("arraybuffer");
        await writeFile(filePath, new Uint8Array(pdfBytes));
      }
    } catch (err) {
      console.error("Error exportando PDF:", err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative flex flex-col w-full max-w-5xl mx-auto my-4 bg-surface-900 rounded-2xl border border-border overflow-hidden">
        {/* Header del modal */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4" style={{ color: report.accent }} />
            <span className="text-sm font-medium text-primary">
              Vista previa — {report.title}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportPDF}
              disabled={exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              {exporting ? "Exportando..." : "Exportar PDF"}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface-800 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Formulario paciente */}
        <div className="px-5 py-3 border-b border-border shrink-0">
          <PatientForm patient={patient} onChange={setPatient} />
          <div className="mt-2">
            <label className="block text-[10px] text-secondary mb-1">
              Observaciones adicionales
            </label>
            <input
              value={patient.notes}
              onChange={(e) => setPatient((p) => ({ ...p, notes: e.target.value }))}
              placeholder="Notas u observaciones para el informe..."
              className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-surface-800/50 text-xs text-primary placeholder:text-muted focus:outline-none focus:border-ecg-500/50 transition-colors"
            />
          </div>
        </div>

        {/* Preview A4 scrollable */}
        <div className="flex-1 overflow-auto bg-surface-950 p-6">
          <div ref={printRef}>
            <ReportPage
              config={config}
              patient={patient}
              report={report}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
