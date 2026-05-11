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

const RECORDING_SECS = 6;
const MAX_RECORDINGS = 9;

const COLORS = [
  "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#a855f7",
  "#ec4899", "#84cc16", "#eab308", "#6366f1",
];

const DEFAULT_REF_LINES: SpiroRefLines = { pef: 1.5, fvc: 4.0 };

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

  // Refs para no provocar re-render por cada muestra (≈50 Hz)
  const lastTMsRef = useRef<number | null>(null);
  const recStartTMsRef = useRef<number | null>(null);
  const pendingRecordRef = useRef(false);
  const accumRef = useRef<SpiroPoint[]>([]);  // grabación activa
  const nextRecIdRef = useRef(1);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fsmRef = useRef<FsmState>(fsm);
  const displayModeRef = useRef<DisplayMode>(displayMode);
  useEffect(() => { fsmRef.current = fsm; }, [fsm]);
  useEffect(() => { displayModeRef.current = displayMode; }, [displayMode]);

  // Sincronizar FSM con la conexión real (cubre desconexión inesperada)
  useEffect(() => {
    if (!serial.isConnected) {
      setFsm("disconnected");
      pendingRecordRef.current = false;
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
    // Detección de reset del Arduino: relativeTime arranca de nuevo en 0
    // cuando enviamos 'r' o 'v'. Limpiamos buffers para no mezclar timelines.
    if (last !== null && last > 1000 && p.t_ms < last * 0.1) {
      accumRef.current = [];
      recStartTMsRef.current = null;
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
      if (tRel <= RECORDING_SECS) {
        accumRef.current.push({ t: tRel, p: p.p, f: p.f, v: p.v });
      } else if (accumRef.current.length > 0) {
        const finished = accumRef.current.slice();
        recStartTMsRef.current = null;
        accumRef.current = [];
        setRecordings((prev) => {
          if (prev.length >= MAX_RECORDINGS) return prev;
          const num = prev.length + 1;
          return [
            ...prev,
            {
              id: nextRecIdRef.current++,
              number: num,
              color: COLORS[(num - 1) % COLORS.length],
              data: finished,
            },
          ];
        });
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
        setElapsed(Math.min(RECORDING_SECS, (Date.now() - start) / 1000));
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
      pendingRecordRef.current = true;
      recStartTMsRef.current = null;
      accumRef.current = [];
      setDisplayData([]);
      // Plot vacío hasta que el trigger (v>0) arranque la grabación.
      setDisplayMode("idle");
    } catch (e) {
      setLastCalMsg(String(e));
    }
  }, []);

  const handleClearAll = useCallback(() => {
    setRecordings([]);
    accumRef.current = [];
    setDisplayData([]);
    recStartTMsRef.current = null;
    pendingRecordRef.current = false;
    setDisplayMode("idle");
    if (fsm === "recording") setFsm("calibrated");
  }, [fsm]);

  const handleDeleteRec = useCallback((id: number) => {
    setRecordings((prev) => prev.filter((r) => r.id !== id));
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
    recStartTMsRef.current = null;
    accumRef.current = [];
    setDisplayData(pts);
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
    recording: `Grabando ${elapsed.toFixed(1)}s / ${RECORDING_SECS}s`,
  };

  return (
    <div>
      <PageHeader
        title="Espirómetro"
        icon={<Wind className="h-5 w-5 text-spiro-400" />}
        actions={<StatusBadge status={status} />}
      />

      {/* Toolbar superior */}
      <Card className="mb-3">
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

      {/* Layout principal: lista de pruebas a la izquierda + gráficas */}
      <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-3 mb-3">
        <Card>
          <CardHeader>Pruebas ({recordings.length}/{MAX_RECORDINGS})</CardHeader>
          <CardContent>
            {recordings.length === 0 ? (
              <p className="text-xs text-muted">Sin grabaciones</p>
            ) : (
              <ul className="space-y-1">
                {recordings.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between text-xs px-1.5 py-1 rounded hover:bg-surface-800"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: r.color }}
                      />
                      Prueba {r.number}
                    </span>
                    <button
                      onClick={() => handleDeleteRec(r.id)}
                      className="text-muted hover:text-red-400 transition-colors"
                      title="Eliminar"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <span>Volumen / Tiempo · Flujo / Volumen</span>
              <span className="text-xs text-secondary">{fsmLabel[fsm]}</span>
            </div>
          </CardHeader>
          <CardContent>
            <div ref={chartsHostRef}>
              <SpiroCharts
                current={displayData}
                recordings={recordings}
                refLines={refLines}
                onRefLinesChange={setRefLines}
                height={320}
              />
            </div>
            {lastCalMsg && (
              <p className="text-[10px] text-secondary mt-1 font-mono truncate">
                {lastCalMsg}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Controles inferiores */}
      <Card className="mb-3">
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button onClick={handleStart} disabled={!canStart} variant="primary">
            <Play className="h-4 w-4 mr-1" />Iniciar
          </Button>
          <Button onClick={handleClearAll} disabled={!canClear} variant="ghost">
            <Eraser className="h-4 w-4 mr-1" />Borrar
          </Button>
          <Button onClick={handleCalibrate} disabled={!canCalibrate} variant="secondary">
            <RefreshCcw className="h-4 w-4 mr-1" />Calibrar
          </Button>
          <Button onClick={handleSaveCSV} disabled={displayData.length === 0} variant="ghost">
            <SaveIcon className="h-4 w-4 mr-1" />Guardar
          </Button>
          <div className="ml-auto">
            <button
              onClick={handleOpenReport}
              disabled={displayData.length === 0 && recordings.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 disabled:opacity-30 transition-colors"
            >
              <FileText className="h-3.5 w-3.5" />
              Vista previa informe
            </button>
          </div>
        </CardContent>
      </Card>

      <ReportPreview open={reportOpen} onClose={() => setReportOpen(false)} report={spiroReport} />
    </div>
  );
}
