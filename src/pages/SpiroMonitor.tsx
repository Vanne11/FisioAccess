import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Wind, Trash2, FileText, FolderOpen, Save as SaveIcon, Eraser, Play, RefreshCcw } from "lucide-react";
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
  type SpiroRefLines,
  type SpiroMarkerLines,
} from "@/components/shared/SpiroCharts";
import { ReportPreview, type ReportData } from "@/components/shared/ReportPreview";

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

const DEFAULT_REF_LINES: SpiroRefLines = { pef: 1.5, fvc: 4.0 };
const DEFAULT_MARKER_LINES: SpiroMarkerLines = { a: 1.0, b: 2.0 };

const LS_MAX_RECORDINGS = "spiro.maxRecordings";
const LS_RECORDING_SECS = "spiro.recordingSecs";
const LS_MARKER_A = "spiro.markerA";
const LS_MARKER_B = "spiro.markerB";

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
  const [refLines, setRefLines] = useState<SpiroRefLines>(DEFAULT_REF_LINES);
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
          const num = prev.length + 1;
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

  // ─── CSV ─────────────────────────────────────────────────────────
  const handleSaveCSV = useCallback(async () => {
    if (displayData.length === 0) return;
    const lines = ["tiempo,presion,flujo,volumen"];
    for (const p of displayData) {
      lines.push(`${p.t.toFixed(3)},${p.p.toFixed(4)},${p.f.toFixed(4)},${p.v.toFixed(4)}`);
    }
    const csv = lines.join("\n") + "\n";
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const path = await saveDialog({
      defaultPath: `spiro_${stamp}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return;
    await writeFile(path, new TextEncoder().encode(csv));
  }, [displayData]);

  const handleOpenCSV = useCallback(async () => {
    const path = await openDialog({
      multiple: false,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path || typeof path !== "string") return;
    const text = await readTextFile(path);
    const rows = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (rows.length < 2) return;
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
    if (serial.isConnected) await serial.disconnect();
    pendingRecordRef.current = false;
    pendingArmRef.current = false;
    clearArmFallback();
    recStartTMsRef.current = null;
    accumRef.current = [];
    setDisplayData(pts);
    setSelectedRecId(null);
    setDisplayMode("imported");
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
              { label: "FVC visual (curva actual)", value: peakVol.toFixed(2), unit: "L" },
              { label: "PEF (referencia)", value: refLines.pef.toFixed(2), unit: "L" },
              { label: "FVC (referencia)", value: refLines.fvc.toFixed(2), unit: "L" },
            ]
          : []),
      ],
      signalImage: reportImage,
      signalLabel: "Curvas Volumen/Tiempo y Flujo/Volumen",
    };
  }, [recordings.length, displayData, refLines, reportImage]);

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
  const measurements = useMemo(() => {
    if (currentCurve.length === 0) {
      return null;
    }
    const pef = currentCurve.reduce((m, p) => (p.f > m ? p.f : m), -Infinity);
    const fvc = currentCurve.reduce((m, p) => (p.v > m ? p.v : m), -Infinity);
    const interpAt = (xTarget: number): number | null => {
      if (currentCurve.length < 2) return null;
      if (xTarget < currentCurve[0].t || xTarget > currentCurve[currentCurve.length - 1].t) return null;
      let i = 1;
      while (i < currentCurve.length && currentCurve[i].t < xTarget) i++;
      if (i >= currentCurve.length) return currentCurve[currentCurve.length - 1].v;
      const p0 = currentCurve[i - 1];
      const p1 = currentCurve[i];
      if (p1.t === p0.t) return p0.v;
      const t = (xTarget - p0.t) / (p1.t - p0.t);
      return p0.v + (p1.v - p0.v) * t;
    };
    const fevA = interpAt(markerLines.a);
    const fevB = interpAt(markerLines.b);
    const flowAtVolume = (target: number): number | null => {
      for (let i = 1; i < currentCurve.length; i++) {
        const v0 = currentCurve[i - 1].v;
        const v1 = currentCurve[i].v;
        if (v0 <= target && v1 >= target && v1 !== v0) {
          const t = (target - v0) / (v1 - v0);
          return currentCurve[i - 1].f + (currentCurve[i].f - currentCurve[i - 1].f) * t;
        }
      }
      return null;
    };
    return {
      pef: Number.isFinite(pef) ? pef : null,
      fvc: Number.isFinite(fvc) ? fvc : null,
      fevA,
      fevB,
      deltaV: fevA !== null && fevB !== null ? Math.abs(fevB - fevA) : null,
      fef25: Number.isFinite(fvc) ? flowAtVolume(0.25 * fvc) : null,
      fef50: Number.isFinite(fvc) ? flowAtVolume(0.50 * fvc) : null,
      fef75: Number.isFinite(fvc) ? flowAtVolume(0.75 * fvc) : null,
    };
  }, [currentCurve, markerLines]);

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
          <Button onClick={handleOpenCSV} variant="ghost" disabled={isRecording}>
            <FolderOpen className="h-4 w-4 mr-1" />Abrir
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
                    return (
                      <li
                        key={r.id}
                        onClick={() => !isRecording && setSelectedRecId(isSelected ? null : r.id)}
                        className={`flex items-center justify-between text-xs px-1.5 py-1 rounded transition-colors ${
                          isRecording ? "cursor-default" : "cursor-pointer"
                        } ${
                          isSelected
                            ? "bg-spiro-500/20 ring-1 ring-spiro-400"
                            : "hover:bg-surface-800"
                        }`}
                        title={isSelected ? "Click para deseleccionar" : "Click para activar esta curva"}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: r.color }}
                          />
                          Prueba {r.number}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteRec(r.id); }}
                          className="text-muted hover:text-red-400 transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="flex-1">
            <CardHeader>
              {selectedRec
                ? `Datos · Prueba ${selectedRec.number}`
                : "Datos"}
            </CardHeader>
            <CardContent>
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
                  <span className="col-span-2 border-t border-surface-700 my-1" />
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
                  {measurements.fevA !== null && measurements.fvc !== null && measurements.fvc > 0 && (
                    <>
                      <span className="text-secondary">FEV(A)/FVC</span>
                      <span className="text-right">
                        {((measurements.fevA / measurements.fvc) * 100).toFixed(1)} %
                      </span>
                    </>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted">Sin datos</p>
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
                  recordings={otherRecordings}
                  refLines={refLines}
                  onRefLinesChange={setRefLines}
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
              <Button onClick={handleCalibrate} disabled={!canCalibrate} variant="secondary">
                <RefreshCcw className="h-4 w-4 mr-1" />Calibrar
              </Button>
              <Button onClick={handleClearAll} disabled={!canClear} variant="ghost">
                <Eraser className="h-4 w-4 mr-1" />Borrar
              </Button>
              <Button onClick={handleSaveCSV} disabled={displayData.length === 0} variant="ghost">
                <SaveIcon className="h-4 w-4 mr-1" />Guardar
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
    </div>
  );
}
