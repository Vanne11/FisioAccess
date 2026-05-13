import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Wind, Trash2, FileText, FolderOpen, Eraser, Play, RefreshCcw, FileSignature, FlaskConical } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { writeFile, readTextFile } from "@tauri-apps/plugin-fs";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import { SerialSelect } from "@/components/shared/SerialSelect";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PageHeader } from "@/components/layout/PageHeader";
import { useSerial } from "@/hooks/useSerial";
import {
  SpiroCharts,
  type SpiroPoint,
  type SpiroRecording,
  type SpiroMarkerLines,
} from "@/components/shared/SpiroCharts";
import { ReportPreview, type ReportData } from "@/components/shared/ReportPreview";
import { SpiroSaveDialog } from "@/components/shared/SpiroSaveDialog";
import {
  buildStudy,
  studyToPythonJSON,
  studyFromPythonJSON,
  studyFilename,
  type BronchodilatorStatus,
  type SpiroPatient,
  type SpiroAnalysis,
} from "@/lib/spiro/types";
import {
  computeSpiroMetrics,
  averageMetrics,
  type SpiroMetrics,
  type SpiroGroupAverage,
} from "@/lib/spiro/metrics";
import {
  computeQuality,
  computeSuggestions,
  gradeColorClasses,
  type QualityResult,
  type QualitySuggestion,
} from "@/lib/spiro/quality";
import { generateSpiroPDF } from "@/lib/spiro/pdf";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { useReportStore } from "@/stores/useReportStore";

interface SpiroDataPayload {
  t_ms: number;
  p: number;
  f: number;
  v: number;
}

type FsmState =
  | "disconnected"
  | "connected"
  | "calibrating"
  | "calibrated"
  | "recording";

const DEFAULT_RECORDING_SECS = 6;
const DEFAULT_MAX_RECORDINGS = 9;
const MAX_RECORDINGS_LIMIT = 20;
const MAX_RECORDING_SECS_LIMIT = 30;

const COLORS = [
  "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#a855f7",
  "#ec4899", "#84cc16", "#eab308", "#6366f1",
  "#14b8a6", "#f43f5e", "#8b5cf6", "#22d3ee", "#facc15",
  "#fb923c", "#22c55e", "#0ea5e9", "#d946ef", "#65a30d",
];

// refLines se mantiene en el formato de estudio JSON con un valor fijo
// (la gráfica calcula PEF/FVC automáticamente desde la curva).
const STUDY_REF_LINES = { pef: 1.5, fvc: 4.0 };
const DEFAULT_MARKER_LINES: SpiroMarkerLines = { a: 1.0, b: 2.0 };

const LS_MAX_RECORDINGS = "spiro.maxRecordings";
const LS_RECORDING_SECS = "spiro.recordingSecs";
const LS_MARKER_A = "spiro.markerA";
const LS_MARKER_B = "spiro.markerB";

function QualityBlock({
  label,
  data,
  accent,
}: {
  label: string;
  data: {
    quality: QualityResult;
    suggestions: QualitySuggestion[];
  };
  accent: string;
}) {
  const { quality, suggestions } = data;
  return (
    <div className="mb-2 last:mb-0">
      <div className="flex items-center justify-between text-xs">
        <span className={`font-semibold ${accent}`}>{label}</span>
        <span className="flex items-center gap-1.5">
          <span
            className={`px-1.5 py-0.5 rounded text-xs font-bold ${gradeColorClasses(quality.grade)}`}
          >
            {quality.grade}
          </span>
          <span className="text-secondary">
            n={quality.nManeuvers}
            {quality.repeatabilityMl !== null
              ? ` · rep ${quality.repeatabilityMl.toFixed(0)} ml`
              : ""}
          </span>
        </span>
      </div>
      {quality.nRejectedBev > 0 && (
        <div
          className="mt-1 text-[10px] text-red-300"
          title="Maniobras con BEV > máx(150 mL, 5% FVC) — no cumplen aceptabilidad ATS/ERS"
        >
          {quality.nRejectedBev} maniobra{quality.nRejectedBev === 1 ? "" : "s"} rechazada
          {quality.nRejectedBev === 1 ? "" : "s"} por BEV
        </div>
      )}
      {suggestions.length > 0 && (
        <ul className="mt-1 text-xs text-secondary space-y-0.5">
          {suggestions.map((s) => (
            <li key={s.removeRecordingNumber}>
              · Quitar Prueba {s.removeRecordingNumber} →{" "}
              <span className="text-emerald-300 font-semibold">{s.newGrade}</span>
              {s.newRepeatabilityMl !== null
                ? ` (rep ${s.newRepeatabilityMl.toFixed(0)} ml)`
                : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GroupRow({
  label,
  pre,
  post,
  digits = 2,
  suffix = "",
}: {
  label: string;
  pre: number | null;
  post: number | null;
  digits?: number;
  suffix?: string;
}) {
  const fmt = (v: number | null) =>
    v !== null && Number.isFinite(v) ? `${v.toFixed(digits)}${suffix}` : "—";
  return (
    <tr>
      <td className="text-secondary pr-1">{label}</td>
      <td className="text-right pr-1 text-sky-300">{fmt(pre)}</td>
      <td className="text-right text-amber-300">{fmt(post)}</td>
    </tr>
  );
}

function loadNumber(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw == null) return fallback;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

export function SpiroMonitor() {
  // useSerial sólo se usa para conectar/desconectar y listar puertos.
  // En modo "spiro" el backend emite `spiro-data`, no `serial-data`, así
  // que serial.data se queda vacío — la página mantiene su propio buffer.
  const serial = useSerial(115200, 1, "spiro");

  // Modo de display: qué curva pinta la gráfica.
  //  idle      → nada visible (entre tests / esperando trigger)
  //  recording → grabación en curso (t relativo 0–6 s)
  //  frozen    → última grabación congelada en pantalla
  //  imported  → CSV cargado desde disco
  type DisplayMode = "idle" | "recording" | "frozen" | "imported";

  const [fsm, setFsm] = useState<FsmState>("disconnected");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("idle");
  const [displayData, setDisplayData] = useState<SpiroPoint[]>([]);
  const [recordings, setRecordings] = useState<SpiroRecording[]>([]);
  const [lastCalMsg, setLastCalMsg] = useState<string>("");
  const [elapsed, setElapsed] = useState(0);

  // Configuración persistida en localStorage
  const [maxRecordings, setMaxRecordings] = useState<number>(() =>
    loadNumber(LS_MAX_RECORDINGS, DEFAULT_MAX_RECORDINGS, 1, MAX_RECORDINGS_LIMIT),
  );
  const [recordingSecs, setRecordingSecs] = useState<number>(() =>
    loadNumber(LS_RECORDING_SECS, DEFAULT_RECORDING_SECS, 1, MAX_RECORDING_SECS_LIMIT),
  );
  const [markerLines, setMarkerLines] = useState<SpiroMarkerLines>(() => ({
    a: loadNumber(LS_MARKER_A, DEFAULT_MARKER_LINES.a, 0, 17),
    b: loadNumber(LS_MARKER_B, DEFAULT_MARKER_LINES.b, 0, 17),
  }));
  const recordingSecsRef = useRef(recordingSecs);
  useEffect(() => { recordingSecsRef.current = recordingSecs; }, [recordingSecs]);
  const maxRecordingsRef = useRef(maxRecordings);
  useEffect(() => { maxRecordingsRef.current = maxRecordings; }, [maxRecordings]);

  useEffect(() => {
    window.localStorage.setItem(LS_MAX_RECORDINGS, String(maxRecordings));
  }, [maxRecordings]);
  useEffect(() => {
    window.localStorage.setItem(LS_RECORDING_SECS, String(recordingSecs));
  }, [recordingSecs]);
  useEffect(() => {
    window.localStorage.setItem(LS_MARKER_A, String(markerLines.a));
    window.localStorage.setItem(LS_MARKER_B, String(markerLines.b));
  }, [markerLines]);

  // Prueba seleccionada (id). Cuando se selecciona, esa curva es la
  // "activa" (sólida) sobre la que operan los marcadores vLine A/B.
  const [selectedRecId, setSelectedRecId] = useState<number | null>(null);

  // Estado broncodilatador por maniobra (id -> PRE/POST). Default PRE.
  // La UI para alternar PRE/POST llega en la tarea #2; aquí dejamos el
  // estado expuesto para que el guardado JSON pueda persistirlo.
  const [bronchoByRec, setBronchoByRec] = useState<Record<number, BronchodilatorStatus>>({});

  // Datos del estudio en memoria (paciente + análisis) para reutilizar
  // entre Guardar y Vista previa, y para conservar lo escrito al recargar.
  const [studyPatient, setStudyPatient] = useState<SpiroPatient | undefined>();
  const [studyAnalysis, setStudyAnalysis] = useState<SpiroAnalysis | undefined>();
  const [saveOpen, setSaveOpen] = useState(false);
  const workDir = useWorkspaceStore((s) => s.workDir);
  const reportConfig = useReportStore((s) => s.config);

  // Refs para no provocar re-render por cada muestra (≈50 Hz)
  const lastTMsRef = useRef<number | null>(null);
  const recStartTMsRef = useRef<number | null>(null);
  const pendingRecordRef = useRef(false);
  // Tras pulsar Iniciar, esperamos a confirmar el reset del firmware antes
  // de armar pendingRecord. Esto evita que samples stale (con v>0 del test
  // anterior) en el buffer disparen un trigger fantasma.
  const pendingArmRef = useRef(false);
  const armFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accumRef = useRef<SpiroPoint[]>([]);  // grabación activa
  const nextRecIdRef = useRef(1);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearArmFallback = () => {
    if (armFallbackTimerRef.current) {
      clearTimeout(armFallbackTimerRef.current);
      armFallbackTimerRef.current = null;
    }
  };

  const fsmRef = useRef<FsmState>(fsm);
  const displayModeRef = useRef<DisplayMode>(displayMode);
  useEffect(() => { fsmRef.current = fsm; }, [fsm]);
  useEffect(() => { displayModeRef.current = displayMode; }, [displayMode]);

  // Sincronizar FSM con la conexión real (cubre desconexión inesperada)
  useEffect(() => {
    if (!serial.isConnected) {
      setFsm("disconnected");
      pendingRecordRef.current = false;
      pendingArmRef.current = false;
      clearArmFallback();
      recStartTMsRef.current = null;
      lastTMsRef.current = null;
    } else if (fsmRef.current === "disconnected") {
      setFsm("connected");
    }
  }, [serial.isConnected]);

  // ─── Listeners de eventos del backend ────────────────────────────
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let mounted = true;

    (async () => {
      const u1 = await listen<SpiroDataPayload>("spiro-data", (e) => {
        if (!mounted) return;
        handleSample(e.payload);
      });
      const u2 = await listen<string>("spiro-calibration-msg", (e) => {
        if (!mounted) return;
        const msg = e.payload;
        setLastCalMsg(msg);
        if (/Iniciando calibraci/i.test(msg)) {
          setFsm("calibrating");
        } else if (/Iniciando mediciones/i.test(msg)) {
          // Calibración terminó. Limpiar plot y dejar al usuario apretar Iniciar.
          pendingRecordRef.current = false;
          pendingArmRef.current = false;
          clearArmFallback();
          recStartTMsRef.current = null;
          accumRef.current = [];
          setDisplayData([]);
          setDisplayMode("idle");
          setFsm("calibrated");
        }
      });
      unlisteners.push(u1, u2);
    })();

    return () => {
      mounted = false;
      unlisteners.forEach((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Muestra recibida: detecta reset del Arduino y alimenta la grabación
  // activa. Igual que la versión Python: si no hay grabación en curso,
  // la muestra se ignora (plot vacío entre tests). Llamada a ≈50 Hz —
  // las muestras de grabación se acumulan en ref; un flush periódico
  // actualiza el state.
  const handleSample = useCallback((p: SpiroDataPayload) => {
    const last = lastTMsRef.current;
    // Detección de reset del Arduino: t_ms decrece estrictamente sólo
    // cuando el firmware procesa 'r' o 'v'. En operación normal es
    // monotónico creciente.
    if (last !== null && p.t_ms < last) {
      accumRef.current = [];
      recStartTMsRef.current = null;
      // Si pulsamos Iniciar y estábamos esperando este reset, ahora sí
      // armamos pendingRecord: a partir de aquí los samples son frescos
      // (volumen ya está en 0 en el firmware).
      if (pendingArmRef.current) {
        pendingArmRef.current = false;
        pendingRecordRef.current = true;
        clearArmFallback();
      }
    }
    lastTMsRef.current = p.t_ms;

    // Trigger: tras Iniciar, esperamos el primer volumen positivo
    // (= primera espiración) para arrancar la grabación de 6 s.
    if (pendingRecordRef.current && p.v > 0) {
      pendingRecordRef.current = false;
      recStartTMsRef.current = p.t_ms;
      accumRef.current = [];
      setDisplayMode("recording");
      setFsm("recording");
    }

    // Acumulación durante grabación
    if (recStartTMsRef.current !== null) {
      const tRel = (p.t_ms - recStartTMsRef.current) / 1000;
      const recSecs = recordingSecsRef.current;
      const maxRec = maxRecordingsRef.current;
      if (tRel <= recSecs) {
        accumRef.current.push({ t: tRel, p: p.p, f: p.f, v: p.v });
      } else if (accumRef.current.length > 0) {
        const finished = accumRef.current.slice();
        recStartTMsRef.current = null;
        accumRef.current = [];
        let newId: number | null = null;
        setRecordings((prev) => {
          if (prev.length >= maxRec) return prev;
          const num = prev.length === 0
            ? 1
            : Math.max(...prev.map((r) => r.number)) + 1;
          newId = nextRecIdRef.current++;
          return [
            ...prev,
            {
              id: newId,
              number: num,
              color: COLORS[(num - 1) % COLORS.length],
              data: finished,
            },
          ];
        });
        if (newId !== null) setSelectedRecId(newId);
        setDisplayData(finished);
        setDisplayMode("frozen");
        setFsm("calibrated");
      }
    }
  }, []);

  // Flush periódico (20 Hz): sólo durante grabación activa copiamos
  // accumRef al state. En idle/frozen/imported no se toca displayData.
  useEffect(() => {
    const id = setInterval(() => {
      if (displayModeRef.current === "recording") {
        setDisplayData(accumRef.current.slice());
      }
    }, 50);
    return () => clearInterval(id);
  }, []);

  // Cronómetro visible de la grabación
  useEffect(() => {
    if (fsm === "recording") {
      const start = Date.now();
      setElapsed(0);
      elapsedTimerRef.current = setInterval(() => {
        setElapsed(Math.min(recordingSecsRef.current, (Date.now() - start) / 1000));
      }, 100);
    } else {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
      setElapsed(0);
    }
    return () => {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, [fsm]);

  // ─── Acciones ────────────────────────────────────────────────────
  const handleConnect = useCallback(async () => {
    await serial.connect();
  }, [serial]);

  const handleDisconnect = useCallback(async () => {
    pendingRecordRef.current = false;
    pendingArmRef.current = false;
    clearArmFallback();
    recStartTMsRef.current = null;
    accumRef.current = [];
    setDisplayData([]);
    setDisplayMode("idle");
    await serial.disconnect();
    setFsm("disconnected");
  }, [serial]);

  const handleCalibrate = useCallback(async () => {
    try {
      await invoke("spiro_send_command", { cmd: "r" });
      pendingRecordRef.current = false;
      pendingArmRef.current = false;
      clearArmFallback();
      recStartTMsRef.current = null;
      accumRef.current = [];
      setDisplayData([]);
      setDisplayMode("idle");
      setFsm("calibrating");
      setLastCalMsg("Calibrando...");
    } catch (e) {
      setLastCalMsg(String(e));
    }
  }, []);

  const handleStart = useCallback(async () => {
    try {
      await invoke("spiro_send_command", { cmd: "v" });
      // No armamos pendingRecord aún: esperamos a que llegue el primer
      // sample post-'v' (t_ms decreciente). Mientras tanto, ignoramos los
      // samples stale que vienen con v>0 del test anterior.
      pendingRecordRef.current = false;
      pendingArmRef.current = true;
      recStartTMsRef.current = null;
      accumRef.current = [];
      setDisplayData([]);
      setSelectedRecId(null);
      setDisplayMode("idle");
      // Fallback: si en 250 ms no detectamos el reset del firmware
      // (edge case: no había samples previos), armamos igual.
      clearArmFallback();
      armFallbackTimerRef.current = setTimeout(() => {
        if (pendingArmRef.current) {
          pendingArmRef.current = false;
          pendingRecordRef.current = true;
        }
        armFallbackTimerRef.current = null;
      }, 250);
    } catch (e) {
      setLastCalMsg(String(e));
    }
  }, []);

  // Genera una maniobra FVC sintética y la añade como prueba.
  // Útil para probar UI/métricas/PDF sin hardware conectado.
  // Cada llamada produce una curva ligeramente distinta para que las
  // métricas ATS/ERS de repetibilidad y los promedios PRE/POST tengan
  // variabilidad realista.
  const handleSimulate = useCallback(() => {
    if (recordings.length >= maxRecordings) return;
    const dt = 0.02; // 50 Hz, igual que el firmware
    const totalSec = recordingSecs;
    // Reparto del tiempo: ~50% espiración, breve plateau, ~45% inspiración.
    // Si recordingSecs es muy corto, se respetan las proporciones.
    const expSec = totalSec * 0.50;
    const plateauSec = totalSec * 0.05;
    const inspSec = totalSec - expSec - plateauSec;

    const pefTarget = 6.0 + (Math.random() - 0.5) * 1.6;   // ~5.2–6.8 L/s
    const fvcTarget = 3.8 + (Math.random() - 0.5) * 0.8;   // ~3.4–4.2 L
    const pifTarget = 4.0 + (Math.random() - 0.5) * 1.2;   // pico inspiratorio
    const tPef = 0.10 + Math.random() * 0.05;
    const tauExp = 0.55 + Math.random() * 0.20;
    const tPif = 0.35 + Math.random() * 0.15;              // tiempo al PIF
    const tauInsp = 0.65 + Math.random() * 0.20;

    const raw: SpiroPoint[] = [];

    // Fase 1: espiración (0 → expSec)
    for (let t = 0; t <= expSec + 1e-9; t += dt) {
      let f: number;
      if (t < tPef) {
        f = pefTarget * (t / tPef);
      } else {
        f = pefTarget * Math.exp(-(t - tPef) / tauExp);
      }
      f += (Math.random() - 0.5) * 0.06;
      raw.push({ t, p: 0, f, v: 0 });
    }

    // Fase 2: plateau (flujo cerca de 0)
    for (let t = expSec + dt; t <= expSec + plateauSec + 1e-9; t += dt) {
      const f = (Math.random() - 0.5) * 0.05;
      raw.push({ t, p: 0, f, v: 0 });
    }

    // Fase 3: inspiración (flujo negativo, sube y luego decae)
    const tInspStart = expSec + plateauSec;
    for (let t = tInspStart + dt; t <= totalSec + 1e-9; t += dt) {
      const dtRel = t - tInspStart;
      let f: number;
      if (dtRel < tPif) {
        f = -pifTarget * (dtRel / tPif);
      } else {
        f = -pifTarget * Math.exp(-(dtRel - tPif) / tauInsp);
      }
      f += (Math.random() - 0.5) * 0.06;
      raw.push({ t, p: 0, f, v: 0 });
    }

    // Integración trapezoidal: V(t) = ∫f dt
    let acc = 0;
    for (let i = 0; i < raw.length; i++) {
      acc += raw[i].f * dt;
      raw[i].v = acc;
    }
    // Escalar para que el volumen máximo coincida con FVC objetivo
    const maxV = raw.reduce((m, p) => Math.max(m, p.v), 0);
    if (maxV > 0) {
      const scale = fvcTarget / maxV;
      for (const p of raw) {
        p.v *= scale;
        p.f *= scale;
        p.p = 0.08 * p.f;
      }
    }

    let newId: number | null = null;
    setRecordings((prev) => {
      if (prev.length >= maxRecordings) return prev;
      const num = prev.length === 0
        ? 1
        : Math.max(...prev.map((r) => r.number)) + 1;
      newId = nextRecIdRef.current++;
      return [
        ...prev,
        {
          id: newId,
          number: num,
          color: COLORS[(num - 1) % COLORS.length],
          data: raw,
        },
      ];
    });
    if (newId !== null) setSelectedRecId(newId);
    setDisplayData(raw);
    setDisplayMode("frozen");
    setLastCalMsg("Prueba sintética generada");
  }, [recordings.length, maxRecordings, recordingSecs]);

  const handleClearAll = useCallback(() => {
    setRecordings([]);
    accumRef.current = [];
    setDisplayData([]);
    setSelectedRecId(null);
    recStartTMsRef.current = null;
    pendingRecordRef.current = false;
    pendingArmRef.current = false;
    clearArmFallback();
    setDisplayMode("idle");
    if (fsm === "recording") setFsm("calibrated");
  }, [fsm]);

  const handleDeleteRec = useCallback((id: number) => {
    setRecordings((prev) => prev.filter((r) => r.id !== id));
    setSelectedRecId((cur) => (cur === id ? null : cur));
  }, []);

  // ─── Estudio (JSON con paciente + maniobras) ─────────────────────
  // Charts ocultos para capturar PRE y POST por separado en el PDF.
  // Cuando hiddenRecordings tiene contenido, el chart oculto se renderiza
  // con esos datos; al terminar la captura se vacía.
  const hiddenChartsRef = useRef<HTMLDivElement>(null);
  const [hiddenRecordings, setHiddenRecordings] = useState<SpiroRecording[]>([]);

  const canvasToWhiteBgPNG = (canvas: HTMLCanvasElement): string => {
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext("2d");
    if (!ctx) return "";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);
    return out.toDataURL("image/png");
  };

  const captureFilteredCharts = useCallback(
    async (recs: SpiroRecording[]): Promise<{ vt?: string; fv?: string }> => {
      if (recs.length === 0) return {};
      setHiddenRecordings(recs);
      // Esperar a que React monte el chart oculto y los useEffects internos
      // dibujen los canvas (paint completo). Dos rAF garantiza ambos pasos.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const host = hiddenChartsRef.current;
      if (!host) return {};
      const canvases = host.querySelectorAll("canvas");
      if (canvases.length < 2) return {};
      return {
        vt: canvasToWhiteBgPNG(canvases[0] as HTMLCanvasElement),
        fv: canvasToWhiteBgPNG(canvases[1] as HTMLCanvasElement),
      };
    },
    [],
  );

  // Guarda el estudio en JSON y, en paralelo, un PDF clínico con el mismo
  // nombre base. El usuario elige la ruta del .json; el .pdf se escribe
  // junto, reemplazando la extensión.
  const handleSave = useCallback(
    async (patient: SpiroPatient, analysis: SpiroAnalysis) => {
      const study = buildStudy({
        patient,
        analysis,
        recordings,
        bronchodilatorByRec: bronchoByRec,
        refLines: STUDY_REF_LINES,
        markerLines,
      });
      const json = studyToPythonJSON(study);
      const filename = studyFilename(patient, study.timestamp);
      const defaultPath = workDir ? `${workDir}/${filename}` : filename;
      const path = await saveDialog({
        defaultPath,
        filters: [{ name: "Estudio espirometría", extensions: ["json"] }],
      });
      if (!path) return;
      const pdfPath = path.replace(/\.json$/i, "") + ".pdf";

      await writeFile(path, new TextEncoder().encode(json));

      // Capturar gráficos PRE y POST por separado renderizándolos en el
      // canvas oculto. Si el grupo está vacío, captureFilteredCharts
      // devuelve {} y el PDF omite la sección correspondiente.
      const preRecs = recordings.filter(
        (r) => (bronchoByRec[r.id] ?? "PRE") === "PRE",
      );
      const postRecs = recordings.filter((r) => bronchoByRec[r.id] === "POST");
      const preCharts = await captureFilteredCharts(preRecs);
      const postCharts = await captureFilteredCharts(postRecs);
      setHiddenRecordings([]);

      const pdf = generateSpiroPDF(study, {
        config: reportConfig,
        charts: { pre: preCharts, post: postCharts },
      });
      const bytes = pdf.output("arraybuffer");
      await writeFile(pdfPath, new Uint8Array(bytes));

      setStudyPatient(patient);
      setStudyAnalysis(analysis);
      setLastCalMsg(`Estudio guardado: ${path}  +  ${pdfPath}`);
    },
    [recordings, bronchoByRec, markerLines, workDir, reportConfig, captureFilteredCharts],
  );

  const handleOpenSave = useCallback(() => {
    setSaveOpen(true);
  }, []);

  // Abrir unificado: acepta .json (estudio completo) o .csv (curva cruda
  // que se agrega como una prueba más a la lista).
  const handleOpen = useCallback(async () => {
    const path = await openDialog({
      multiple: false,
      filters: [
        { name: "Estudio o CSV", extensions: ["json", "csv"] },
        { name: "Estudio espirometría", extensions: ["json"] },
        { name: "CSV", extensions: ["csv"] },
      ],
    });
    if (!path || typeof path !== "string") return;
    const isCsv = /\.csv$/i.test(path);

    let text: string;
    try {
      text = await readTextFile(path);
    } catch (e) {
      setLastCalMsg(`No se pudo leer: ${e}`);
      return;
    }

    if (isCsv) {
      const rows = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (rows.length < 2) {
        setLastCalMsg("CSV vacío");
        return;
      }
      const header = rows[0].toLowerCase().split(",").map((s) => s.trim());
      const idxT = header.indexOf("tiempo");
      const idxP = header.indexOf("presion");
      const idxF = header.indexOf("flujo");
      const idxV = header.indexOf("volumen");
      if (idxT < 0 || idxP < 0 || idxF < 0 || idxV < 0) {
        setLastCalMsg("CSV inválido: faltan columnas tiempo,presion,flujo,volumen");
        return;
      }
      const pts: SpiroPoint[] = [];
      for (let i = 1; i < rows.length; i++) {
        const c = rows[i].split(",");
        const t = parseFloat(c[idxT]);
        const p = parseFloat(c[idxP]);
        const f = parseFloat(c[idxF]);
        const v = parseFloat(c[idxV]);
        if ([t, p, f, v].some((n) => Number.isNaN(n))) continue;
        pts.push({ t, p, f, v });
      }
      if (pts.length === 0) {
        setLastCalMsg("CSV sin filas válidas");
        return;
      }
      if (serial.isConnected) await serial.disconnect();
      pendingRecordRef.current = false;
      pendingArmRef.current = false;
      clearArmFallback();
      recStartTMsRef.current = null;
      accumRef.current = [];

      let newId: number | null = null;
      setRecordings((prev) => {
        if (prev.length >= maxRecordingsRef.current) return prev;
        const num = prev.length === 0
          ? 1
          : Math.max(...prev.map((r) => r.number)) + 1;
        newId = nextRecIdRef.current++;
        return [
          ...prev,
          {
            id: newId,
            number: num,
            color: COLORS[(num - 1) % COLORS.length],
            data: pts,
          },
        ];
      });
      if (newId !== null) setSelectedRecId(newId);
      setDisplayData(pts);
      setDisplayMode("imported");
      setLastCalMsg(`CSV cargado como prueba (${pts.length} muestras)`);
      return;
    }

    // JSON: estudio completo
    let study;
    try {
      study = studyFromPythonJSON(text);
    } catch (e) {
      setLastCalMsg(`Estudio inválido: ${e}`);
      return;
    }
    if (serial.isConnected) await serial.disconnect();
    pendingRecordRef.current = false;
    pendingArmRef.current = false;
    clearArmFallback();
    recStartTMsRef.current = null;
    accumRef.current = [];
    setDisplayData([]);
    setDisplayMode("imported");
    const newBroncho: Record<number, BronchodilatorStatus> = {};
    const newRecordings: SpiroRecording[] = study.recordings.map((r) => {
      const id = nextRecIdRef.current++;
      newBroncho[id] = r.bronchodilatorStatus;
      return {
        id,
        number: r.recordingNumber,
        color: r.color || COLORS[(r.recordingNumber - 1) % COLORS.length],
        data: r.data,
      };
    });
    setRecordings(newRecordings);
    setBronchoByRec(newBroncho);
    const firstLp = Object.values(study.linePositions)[0];
    if (firstLp) {
      setMarkerLines({ a: firstLp.markerA, b: firstLp.markerB });
    }
    setStudyPatient(study.patient);
    setStudyAnalysis(study.analysis);
    setSelectedRecId(newRecordings[0]?.id ?? null);
    setLastCalMsg(
      `Estudio cargado: ${study.patient.nombre || "(sin nombre)"} — ${newRecordings.length} maniobra(s)`,
    );
  }, [serial]);

  // ─── Habilitación de botones (spec sección 5) ────────────────────
  const isConnected = fsm !== "disconnected";
  const isRecording = fsm === "recording";
  const isCalibrated = fsm === "calibrated" || fsm === "recording";

  const canStart = isConnected && isCalibrated && !isRecording;
  const canCalibrate = isConnected && !isRecording;
  const canClear = isConnected && !isRecording;
  const canSelectPort = !serial.isConnected && !isRecording;

  // ─── Vista previa de informe ────────────────────────────────────
  const [reportOpen, setReportOpen] = useState(false);
  const chartsHostRef = useRef<HTMLDivElement>(null);

  const handleOpenReport = useCallback(async () => {
    // Captura el contenedor (ambos canvas) como dataURL combinado
    const host = chartsHostRef.current;
    if (!host) {
      setReportOpen(true);
      return;
    }
    const canvases = host.querySelectorAll("canvas");
    if (canvases.length === 0) {
      setReportOpen(true);
      return;
    }
    let totalW = 0;
    let maxH = 0;
    canvases.forEach((c) => {
      totalW += c.width;
      maxH = Math.max(maxH, c.height);
    });
    const out = document.createElement("canvas");
    out.width = totalW;
    out.height = maxH;
    const ctx = out.getContext("2d");
    if (ctx) {
      let x = 0;
      canvases.forEach((c) => {
        ctx.drawImage(c, x, 0);
        x += c.width;
      });
    }
    setReportImage(out.toDataURL("image/png"));
    setReportOpen(true);
  }, []);

  const [reportImage, setReportImage] = useState("");

  const spiroReport: ReportData = useMemo(() => {
    const peakFlow = displayData.length > 0
      ? Math.max(...displayData.map((p) => p.f))
      : 0;
    const peakVol = displayData.length > 0
      ? Math.max(...displayData.map((p) => p.v))
      : 0;
    return {
      title: "Espirometria",
      accent: "#8b5cf6",
      fields: [
        { label: "Numero de pruebas", value: recordings.length.toString() },
        ...(displayData.length > 0
          ? [
              { label: "PEF (curva actual)", value: peakFlow.toFixed(2), unit: "L/s" },
              { label: "FVC (curva actual)", value: peakVol.toFixed(2), unit: "L" },
            ]
          : []),
      ],
      signalImage: reportImage,
      signalLabel: "Curvas Volumen/Tiempo y Flujo/Volumen",
    };
  }, [recordings.length, displayData, reportImage]);

  // ─── Status badge ────────────────────────────────────────────────
  const status = ((): "disconnected" | "connected" | "calibrated" | "testing" => {
    if (fsm === "recording") return "testing";
    if (!serial.isConnected) return "disconnected";
    if (fsm === "calibrated") return "calibrated";
    return "connected";
  })();

  const fsmLabel: Record<FsmState, string> = {
    disconnected: "Desconectado",
    connected: "Conectado",
    calibrating: "Calibrando…",
    calibrated: "Calibrado",
    recording: `Grabando ${elapsed.toFixed(1)}s / ${recordingSecs}s`,
  };

  // Curva activa: si hay prueba seleccionada en la lista, esa; si no,
  // displayData (grabación viva, congelada, o CSV importado).
  // Las demás grabaciones se dibujan punteadas como contexto.
  const selectedRec = useMemo(
    () => (selectedRecId !== null ? recordings.find((r) => r.id === selectedRecId) : undefined),
    [selectedRecId, recordings],
  );
  const currentCurve = selectedRec?.data ?? displayData;
  const otherRecordings = useMemo(
    () => (selectedRec ? recordings.filter((r) => r.id !== selectedRec.id) : recordings),
    [selectedRec, recordings],
  );

  // Mediciones calculadas sobre la curva activa.
  // - PEF (L/s): flujo pico = max(f)
  // - FVC (L): volumen máximo alcanzado = max(v)
  // - FEV(A)/FEV(B): volumen interpolado en cada cursor
  // - FEF25/50/75: flujo cuando se ha exhalado 25/50/75 % del FVC
  // - FEV(A)/FVC: ratio (equivale a FEV1/FVC si el cursor A está en 1.0 s)
  const measurements = useMemo<SpiroMetrics | null>(
    () => computeSpiroMetrics(currentCurve, markerLines.a, markerLines.b),
    [currentCurve, markerLines],
  );

  // Helpers PRE/POST
  const getBroncho = useCallback(
    (id: number): BronchodilatorStatus => bronchoByRec[id] ?? "PRE",
    [bronchoByRec],
  );
  const toggleBroncho = useCallback((id: number) => {
    setBronchoByRec((prev) => {
      const cur = prev[id] ?? "PRE";
      return { ...prev, [id]: cur === "PRE" ? "POST" : "PRE" };
    });
  }, []);

  // Métricas y promedios por grupo (PRE/POST) sobre todas las maniobras.
  // Además calculamos grado de calidad ATS/ERS y sugerencias de descarte.
  const groupAnalysis = useMemo<{
    pre: {
      avg: SpiroGroupAverage | null;
      quality: QualityResult;
      suggestions: QualitySuggestion[];
    };
    post: {
      avg: SpiroGroupAverage | null;
      quality: QualityResult;
      suggestions: QualitySuggestion[];
    };
  }>(() => {
    const preMetrics: SpiroMetrics[] = [];
    const preNums: number[] = [];
    const postMetrics: SpiroMetrics[] = [];
    const postNums: number[] = [];
    for (const r of recordings) {
      const m = computeSpiroMetrics(r.data, markerLines.a, markerLines.b);
      if (!m) continue;
      if (getBroncho(r.id) === "POST") {
        postMetrics.push(m);
        postNums.push(r.number);
      } else {
        preMetrics.push(m);
        preNums.push(r.number);
      }
    }
    return {
      pre: {
        avg: preMetrics.length > 0 ? averageMetrics(preMetrics) : null,
        quality: computeQuality(preMetrics),
        suggestions: computeSuggestions(preMetrics, preNums),
      },
      post: {
        avg: postMetrics.length > 0 ? averageMetrics(postMetrics) : null,
        quality: computeQuality(postMetrics),
        suggestions: computeSuggestions(postMetrics, postNums),
      },
    };
  }, [recordings, markerLines, getBroncho]);
  const groupAverages = useMemo(
    () => ({ pre: groupAnalysis.pre.avg, post: groupAnalysis.post.avg }),
    [groupAnalysis],
  );

  // Conjunto de números de prueba que la sugerencia recomienda descartar
  // (para marcarlas visualmente en la lista).
  const suggestedOutliers = useMemo(() => {
    const set = new Set<number>();
    for (const s of groupAnalysis.pre.suggestions) set.add(s.removeRecordingNumber);
    for (const s of groupAnalysis.post.suggestions) set.add(s.removeRecordingNumber);
    return set;
  }, [groupAnalysis]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title="Espirómetro"
        icon={<Wind className="h-5 w-5 text-spiro-400" />}
        actions={<StatusBadge status={status} />}
      />

      {/* Toolbar superior */}
      <Card className="mb-3 shrink-0">
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button onClick={handleOpen} variant="ghost" disabled={isRecording}>
            <FolderOpen className="h-4 w-4 mr-1" />Abrir (.json / .csv)
          </Button>
          <SerialSelect
            ports={serial.ports}
            selectedPort={serial.selectedPort}
            onPortChange={serial.setSelectedPort}
            onRefresh={serial.refreshPorts}
            disabled={!canSelectPort}
          />
          {serial.isConnected ? (
            <Button onClick={handleDisconnect} variant="danger" disabled={isRecording}>
              Desconectar
            </Button>
          ) : (
            <Button onClick={handleConnect} variant="primary">
              Conectar
            </Button>
          )}
          {serial.error && (
            <span className="text-xs text-red-400">{serial.error}</span>
          )}
        </CardContent>
      </Card>

      {/* Layout principal: lateral (pruebas + datos) | charts + controles.
          flex-1 + min-h-0 hace que el chart pueda crecer vertical. */}
      <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-3 flex-1 min-h-0">
        <div className="flex flex-col gap-3 min-h-0">
          <Card>
            <CardHeader>Pruebas ({recordings.length}/{maxRecordings})</CardHeader>
            <CardContent>
              {recordings.length === 0 ? (
                <p className="text-xs text-muted">Sin grabaciones</p>
              ) : (
                <ul className="space-y-1 max-h-56 overflow-y-auto pr-1">
                  {recordings.map((r) => {
                    const isSelected = r.id === selectedRecId;
                    const status = getBroncho(r.id);
                    const isPost = status === "POST";
                    const isOutlier = suggestedOutliers.has(r.number);
                    return (
                      <li
                        key={r.id}
                        onClick={() => !isRecording && setSelectedRecId(isSelected ? null : r.id)}
                        className={`flex items-center justify-between text-xs px-1.5 py-1 rounded transition-colors ${
                          isRecording ? "cursor-default" : "cursor-pointer"
                        } ${
                          !isSelected && isOutlier
                            ? "ring-1 ring-red-500/40 hover:bg-surface-800"
                            : !isSelected
                              ? "hover:bg-surface-800"
                              : ""
                        }`}
                        style={
                          isSelected
                            ? {
                                background: `${r.color}26`, // ~15% alpha
                                boxShadow: `inset 0 0 0 1px ${r.color}`,
                              }
                            : undefined
                        }
                        title={
                          isOutlier
                            ? "Sugerencia: descartar para mejorar el grado de calidad"
                            : isSelected
                              ? "Click para deseleccionar"
                              : "Click para activar esta curva"
                        }
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: r.color }}
                          />
                          <span className="truncate">Prueba {r.number}</span>
                        </span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleBroncho(r.id); }}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wide transition-colors ${
                              isPost
                                ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                                : "bg-sky-500/20 text-sky-300 hover:bg-sky-500/30"
                            }`}
                            title="Click para alternar PRE/POST broncodilatador"
                          >
                            {status}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteRec(r.id); }}
                            className="text-muted hover:text-red-400 transition-colors"
                            title="Eliminar"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <span>
                  {selectedRec ? `Datos · Prueba ${selectedRec.number}` : "Datos"}
                </span>
                {selectedRec && (
                  <span
                    className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                      getBroncho(selectedRec.id) === "POST"
                        ? "bg-amber-500/20 text-amber-300"
                        : "bg-sky-500/20 text-sky-300"
                    }`}
                  >
                    {getBroncho(selectedRec.id)}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 overflow-y-auto">
              {measurements ? (
                <div className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 text-xs font-mono">
                  <span className="text-secondary">PEF</span>
                  <span className="text-right">
                    {measurements.pef !== null ? `${measurements.pef.toFixed(2)} L/s` : "—"}
                  </span>
                  <span className="text-secondary">FVC</span>
                  <span className="text-right">
                    {measurements.fvc !== null ? `${measurements.fvc.toFixed(2)} L` : "—"}
                  </span>
                  <span className="text-secondary">FEF25</span>
                  <span className="text-right">
                    {measurements.fef25 !== null ? `${measurements.fef25.toFixed(2)} L/s` : "—"}
                  </span>
                  <span className="text-secondary">FEF50</span>
                  <span className="text-right">
                    {measurements.fef50 !== null ? `${measurements.fef50.toFixed(2)} L/s` : "—"}
                  </span>
                  <span className="text-secondary">FEF75</span>
                  <span className="text-right">
                    {measurements.fef75 !== null ? `${measurements.fef75.toFixed(2)} L/s` : "—"}
                  </span>
                  {(measurements.fif25 !== null ||
                    measurements.fif50 !== null ||
                    measurements.fif75 !== null) && (
                    <>
                      <span className="text-secondary">FIF25</span>
                      <span className="text-right">
                        {measurements.fif25 !== null ? `${measurements.fif25.toFixed(2)} L/s` : "—"}
                      </span>
                      <span className="text-secondary">FIF50</span>
                      <span className="text-right">
                        {measurements.fif50 !== null ? `${measurements.fif50.toFixed(2)} L/s` : "—"}
                      </span>
                      <span className="text-secondary">FIF75</span>
                      <span className="text-right">
                        {measurements.fif75 !== null ? `${measurements.fif75.toFixed(2)} L/s` : "—"}
                      </span>
                    </>
                  )}
                  <span className="col-span-2 border-t border-surface-700 my-1" />
                  <span className="text-secondary font-semibold">FEV1</span>
                  <span className="text-right font-semibold">
                    {measurements.fev1 !== null ? `${measurements.fev1.toFixed(2)} L` : "—"}
                  </span>
                  <span className="text-secondary font-semibold">FEV1/FVC</span>
                  <span className="text-right font-semibold">
                    {measurements.fev1OverFvc !== null
                      ? `${measurements.fev1OverFvc.toFixed(1)} %`
                      : "—"}
                  </span>
                  <span className="col-span-2 border-t border-surface-700 my-1" />
                  <span className="text-secondary text-[10px]" title="Cursores libres en el gráfico V-t">
                    Cursores
                  </span>
                  <span />
                  <span className="text-secondary" style={{ color: "#ef4444" }}>
                    FEV(A) {markerLines.a.toFixed(2)}s
                  </span>
                  <span className="text-right">
                    {measurements.fevA !== null ? `${measurements.fevA.toFixed(2)} L` : "—"}
                  </span>
                  <span className="text-secondary" style={{ color: "#10b981" }}>
                    FEV(B) {markerLines.b.toFixed(2)}s
                  </span>
                  <span className="text-right">
                    {measurements.fevB !== null ? `${measurements.fevB.toFixed(2)} L` : "—"}
                  </span>
                  <span className="text-secondary" style={{ color: "#22d3ee" }}>ΔV (A→B)</span>
                  <span className="text-right">
                    {measurements.deltaV !== null ? `${measurements.deltaV.toFixed(2)} L` : "—"}
                  </span>
                  {measurements.backExtrap && (() => {
                    const bevMl = measurements.backExtrap.bev * 1000;
                    const limitMl = measurements.fvc !== null
                      ? Math.max(150, 0.05 * measurements.fvc * 1000)
                      : 150;
                    const ok = bevMl <= limitMl;
                    return (
                      <>
                        <span
                          className="text-secondary text-[10px]"
                          title={`Back-extrapolated volume. ATS/ERS exige < ${limitMl.toFixed(0)} mL (máx 150 mL ó 5% FVC)`}
                        >
                          BEV
                        </span>
                        <span
                          className="text-right text-[10px]"
                          style={{ color: ok ? "#10b981" : "#ef4444" }}
                          title={ok ? "Cumple ATS/ERS" : "Excede el umbral ATS/ERS"}
                        >
                          {bevMl.toFixed(0)} mL
                        </span>
                      </>
                    );
                  })()}
                </div>
              ) : (
                <p className="text-xs text-muted">Sin datos</p>
              )}

              {(groupAnalysis.pre.quality.nManeuvers > 0 ||
                groupAnalysis.post.quality.nManeuvers > 0) && (
                <div className="mt-3 pt-3 border-t border-surface-700">
                  <p className="text-sm font-medium text-secondary mb-2">
                    Calidad ATS/ERS
                  </p>
                  <QualityBlock label="PRE" data={groupAnalysis.pre} accent="text-sky-300" />
                  {groupAnalysis.post.quality.nManeuvers > 0 && (
                    <QualityBlock label="POST" data={groupAnalysis.post} accent="text-amber-300" />
                  )}
                </div>
              )}

              {(groupAverages.pre || groupAverages.post) && (
                <div className="mt-3 pt-3 border-t border-surface-700">
                  <p className="text-sm font-medium text-secondary mb-2">
                    Promedios
                  </p>
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="text-secondary">
                        <th className="text-left font-normal pr-1"></th>
                        <th className="text-right font-normal pr-1">PRE</th>
                        <th className="text-right font-normal">POST</th>
                      </tr>
                    </thead>
                    <tbody>
                      <GroupRow
                        label={`n`}
                        pre={groupAverages.pre?.count ?? null}
                        post={groupAverages.post?.count ?? null}
                        digits={0}
                      />
                      <GroupRow
                        label="PEF"
                        pre={groupAverages.pre?.pef ?? null}
                        post={groupAverages.post?.pef ?? null}
                      />
                      <GroupRow
                        label="FVC"
                        pre={groupAverages.pre?.fvc ?? null}
                        post={groupAverages.post?.fvc ?? null}
                      />
                      <GroupRow
                        label="FEV1"
                        pre={groupAverages.pre?.fev1 ?? null}
                        post={groupAverages.post?.fev1 ?? null}
                      />
                      <GroupRow
                        label="FEV1/FVC (avg)"
                        pre={groupAverages.pre?.fev1OverFvc ?? null}
                        post={groupAverages.post?.fev1OverFvc ?? null}
                        digits={1}
                        suffix=" %"
                      />
                      <GroupRow
                        label="Mejor FEV1/FVC"
                        pre={groupAverages.pre?.bestFev1OverBestFvc ?? null}
                        post={groupAverages.post?.bestFev1OverBestFvc ?? null}
                        digits={1}
                        suffix=" %"
                      />
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-3 min-h-0">
          <Card className="flex-1 flex flex-col min-h-0">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2 w-full">
                <div className="flex items-center gap-3">
                  <span>Espirograma</span>
                  <span className="text-xs text-secondary">{fsmLabel[fsm]}</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <label className="flex items-center gap-1.5">
                    <span className="text-secondary">Pruebas</span>
                    <input
                      type="number"
                      min={1}
                      max={MAX_RECORDINGS_LIMIT}
                      value={maxRecordings}
                      disabled={isRecording}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        if (Number.isFinite(n)) {
                          setMaxRecordings(Math.max(1, Math.min(MAX_RECORDINGS_LIMIT, n)));
                        }
                      }}
                      className="w-14 px-1.5 py-0.5 text-xs text-right bg-surface-900 border border-surface-700 rounded disabled:opacity-50"
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span className="text-secondary">Duración</span>
                    <input
                      type="number"
                      min={1}
                      max={MAX_RECORDING_SECS_LIMIT}
                      step={0.5}
                      value={recordingSecs}
                      disabled={isRecording}
                      onChange={(e) => {
                        const n = parseFloat(e.target.value);
                        if (Number.isFinite(n)) {
                          setRecordingSecs(Math.max(1, Math.min(MAX_RECORDING_SECS_LIMIT, n)));
                        }
                      }}
                      className="w-14 px-1.5 py-0.5 text-xs text-right bg-surface-900 border border-surface-700 rounded disabled:opacity-50"
                    />
                    <span className="text-secondary">s</span>
                  </label>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col min-h-0">
              <div ref={chartsHostRef} className="flex-1 min-h-0">
                <SpiroCharts
                  current={currentCurve}
                  currentColor={selectedRec?.color}
                  currentRecording={selectedRec}
                  recordings={otherRecordings}
                  markerLines={markerLines}
                  onMarkerLinesChange={setMarkerLines}
                />
              </div>
              {lastCalMsg && (
                <p className="text-[10px] text-secondary mt-1 font-mono truncate shrink-0">
                  {lastCalMsg}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Controles inferiores: compactos, integrados al chart card */}
          <Card className="shrink-0">
            <CardContent className="flex flex-wrap items-center gap-2 py-2">
              <Button onClick={handleStart} disabled={!canStart} variant="primary">
                <Play className="h-4 w-4 mr-1" />Iniciar
              </Button>
              <Button
                onClick={handleSimulate}
                disabled={isRecording || recordings.length >= maxRecordings}
                variant="ghost"
                title="Generar una maniobra sintética para probar el sistema sin hardware"
              >
                <FlaskConical className="h-4 w-4 mr-1" />Simular
              </Button>
              <Button onClick={handleCalibrate} disabled={!canCalibrate} variant="secondary">
                <RefreshCcw className="h-4 w-4 mr-1" />Calibrar
              </Button>
              <Button onClick={handleClearAll} disabled={!canClear} variant="ghost">
                <Eraser className="h-4 w-4 mr-1" />Borrar
              </Button>
              <Button
                onClick={handleOpenSave}
                disabled={recordings.length === 0 || isRecording}
                variant="secondary"
                title="Guarda el estudio en .json y un PDF clínico con el mismo nombre"
              >
                <FileSignature className="h-4 w-4 mr-1" />Guardar estudio + PDF
              </Button>
              <button
                onClick={handleOpenReport}
                disabled={displayData.length === 0 && recordings.length === 0}
                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 disabled:opacity-30 transition-colors"
              >
                <FileText className="h-3.5 w-3.5" />
                Vista previa informe
              </button>
            </CardContent>
          </Card>
        </div>
      </div>

      <ReportPreview open={reportOpen} onClose={() => setReportOpen(false)} report={spiroReport} />
      <SpiroSaveDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        onSave={handleSave}
        initialPatient={studyPatient}
        initialAnalysis={studyAnalysis}
        recordingsCount={recordings.length}
      />

      {/* Chart oculto fuera de pantalla — se monta durante el guardado
          PDF para capturar PRE y POST por separado. */}
      {hiddenRecordings.length > 0 && (
        <div
          ref={hiddenChartsRef}
          aria-hidden
          style={{
            position: "absolute",
            left: -10000,
            top: 0,
            width: 900,
            height: 260,
            pointerEvents: "none",
          }}
        >
          <SpiroCharts
            current={hiddenRecordings[0].data}
            currentColor={hiddenRecordings[0].color}
            currentRecording={hiddenRecordings[0]}
            recordings={hiddenRecordings.slice(1)}
            markerLines={markerLines}
            onMarkerLinesChange={() => {}}
            height={260}
            minHeight={260}
          />
        </div>
      )}
    </div>
  );
}
