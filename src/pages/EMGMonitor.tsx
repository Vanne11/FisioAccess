import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import {
  BicepsFlexed,
  Pause,
  Play,
  Plug,
  PlugZap,
  Trash2,
  Snowflake,
  FileText,
  Activity,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import { SerialSelect } from "@/components/shared/SerialSelect";
import {
  EMGCanvas,
  EMG_PHASE_CONFIG,
  SCALE_PRESETS,
  DEFAULT_ADC_CONFIG,
  type EMGPhaseMarker,
  type EMGPhaseType,
  type ADCConfig,
} from "@/components/shared/EMGCanvas";
import { VUMeter, DEFAULT_THRESHOLDS, type VUThresholds, type CalibrationStep } from "@/components/shared/VUMeter";
import { PhaseComparison } from "@/components/shared/PhaseComparison";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PageHeader } from "@/components/layout/PageHeader";
import { useSerial } from "@/hooks/useSerial";
import { ReportPreview, type ReportData, captureCanvas } from "@/components/shared/ReportPreview";

interface CalibrationStatus {
  calibrating: boolean;
  calibrated: boolean;
  progress: number;
  offset_mv: number;
}

const EMG_BAUD_RATE = 9600;
const EMG_BUFFER_SIZE = 5000;

// VU Calibration durations in ms
const CAL_REPOSO_MS = 5000;
const CAL_LEVE_MS = 5000;
const CAL_MVC_MS = 3000;

export function EMGMonitor() {
  const serial = useSerial(EMG_BAUD_RATE, EMG_BUFFER_SIZE, "emg");
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [offsetMv, setOffsetMv] = useState(666.0);
  const [frozen, setFrozen] = useState(false);
  const [phaseMarkers, setPhaseMarkers] = useState<EMGPhaseMarker[]>([]);
  const [activePhase, setActivePhase] = useState<EMGPhaseType | null>(null);
  const nextMarkerId = useRef(0);
  const calListenersRef = useRef<UnlistenFn[]>([]);

  // New state
  const [scalePreset, setScalePreset] = useState<number | null>(null);
  const [showRmsEnvelope, setShowRmsEnvelope] = useState(false);
  const [showCalBar, setShowCalBar] = useState(true);
  const [adcConfig, setAdcConfig] = useState<ADCConfig>(DEFAULT_ADC_CONFIG);
  const [showComparison, setShowComparison] = useState(true);

  // VU Meter state
  const [vuThresholds, setVuThresholds] = useState<VUThresholds>(DEFAULT_THRESHOLDS);
  const [vuCalStep, setVuCalStep] = useState<CalibrationStep>("idle");
  const [vuCalProgress, setVuCalProgress] = useState(0);
  const vuCalSamplesRef = useRef<number[]>([]);
  const vuCalTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const vuCalThresholdsRef = useRef<Partial<VUThresholds>>({});

  // ADC calibration listeners
  useEffect(() => {
    let mounted = true;
    const setup = async () => {
      const u1 = await listen<number>("emg-calibration-progress", (e) => {
        if (mounted) setCalibrationProgress(e.payload);
      });
      const u2 = await listen<CalibrationStatus>("emg-calibration-done", (e) => {
        if (mounted) {
          setIsCalibrated(true);
          setCalibrationProgress(0);
          setOffsetMv(e.payload.offset_mv);
          setAdcConfig(prev => ({ ...prev, offset: e.payload.offset_mv }));
        }
      });
      calListenersRef.current = [u1, u2];
    };
    setup();
    return () => {
      mounted = false;
      calListenersRef.current.forEach((fn) => fn());
    };
  }, []);

  // Connection handlers
  const handleConnect = async () => {
    setFrozen(false);
    await serial.connect();
  };

  const handleDisconnect = async () => {
    serial.stopRecording();
    await serial.disconnect();
    setIsCalibrated(false);
    setCalibrationProgress(0);
    setOffsetMv(666.0);
    stopVuCalibration();
  };

  const handlePlayStop = useCallback(() => {
    if (serial.recording) {
      serial.stopRecording();
      setFrozen(true);
    } else {
      setFrozen(false);
      serial.startRecording();
    }
  }, [serial]);

  const handleClearData = useCallback(() => {
    serial.clearData();
    setFrozen(false);
    setPhaseMarkers([]);
    setActivePhase(null);
  }, [serial]);

  const handleFreeze = useCallback(() => setFrozen((f) => !f), []);

  // Phase marking (2-click system)
  const [pendingStart, setPendingStart] = useState<number | null>(null);

  const handlePhaseSelect = useCallback((type: EMGPhaseType) => {
    if (activePhase === type) {
      setActivePhase(null);
      setPendingStart(null);
    } else {
      setActivePhase(type);
      setPendingStart(null);
    }
  }, [activePhase]);

  const handleCanvasClick = useCallback((timestamp_ms: number) => {
    if (!activePhase) return;
    if (pendingStart === null) {
      setPendingStart(timestamp_ms);
    } else {
      const startMs = Math.min(pendingStart, timestamp_ms);
      const endMs = Math.max(pendingStart, timestamp_ms);
      const id = `ph-${nextMarkerId.current++}`;
      setPhaseMarkers((prev) => [...prev, { id, type: activePhase, startMs, endMs }]);
      setPendingStart(null);
    }
  }, [activePhase, pendingStart]);

  const handleMarkerUpdate = useCallback((id: string, startMs: number, endMs: number) => {
    setPhaseMarkers(prev => prev.map(m =>
      m.id === id ? { ...m, startMs, endMs } : m
    ));
  }, []);

  const handleClearMarkers = useCallback(() => {
    setPhaseMarkers([]);
    setActivePhase(null);
    setPendingStart(null);
  }, []);

  // ADC calibration
  const startCalibration = async () => {
    try {
      setCalibrationProgress(0.01);
      await invoke("emg_start_calibration", { durationSecs: 5.0 });
    } catch (e) {
      console.error("Error calibración:", e);
      setCalibrationProgress(0);
    }
  };

  // VU Meter calibration (3-step)
  const stopVuCalibration = useCallback(() => {
    if (vuCalTimerRef.current) {
      clearInterval(vuCalTimerRef.current);
      vuCalTimerRef.current = null;
    }
    setVuCalStep("idle");
    setVuCalProgress(0);
    vuCalSamplesRef.current = [];
  }, []);

  const startVuCalibration = useCallback(() => {
    if (!serial.recording) return;
    vuCalThresholdsRef.current = {};
    runVuCalStep("reposo");
  }, [serial.recording]);

  const runVuCalStep = useCallback((step: CalibrationStep) => {
    if (step === "idle" || step === "done") return;
    setVuCalStep(step);
    setVuCalProgress(0);
    vuCalSamplesRef.current = [];

    const durationMs = step === "mvc" ? CAL_MVC_MS : step === "leve" ? CAL_LEVE_MS : CAL_REPOSO_MS;
    const startTime = Date.now();

    if (vuCalTimerRef.current) clearInterval(vuCalTimerRef.current);
    vuCalTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      setVuCalProgress(progress);

      // Collect RMS samples from recent data
      const recent = serial.data.slice(-15);
      if (recent.length > 0) {
        const rms = Math.sqrt(recent.reduce((s, d) => s + d.value * d.value, 0) / recent.length);
        vuCalSamplesRef.current.push(rms);
      }

      if (elapsed >= durationMs) {
        clearInterval(vuCalTimerRef.current!);
        vuCalTimerRef.current = null;

        // Compute average RMS for this step
        const samples = vuCalSamplesRef.current;
        const avgRms = samples.length > 0 ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;

        if (step === "reposo") {
          vuCalThresholdsRef.current.reposo = avgRms * 1.5;
          runVuCalStep("leve");
        } else if (step === "leve") {
          vuCalThresholdsRef.current.leve = avgRms * 1.2;
          runVuCalStep("mvc");
        } else if (step === "mvc") {
          const reposo = vuCalThresholdsRef.current.reposo ?? DEFAULT_THRESHOLDS.reposo;
          const leve = vuCalThresholdsRef.current.leve ?? DEFAULT_THRESHOLDS.leve;
          const mvc = avgRms * 1.1;
          setVuThresholds({
            reposo: Math.max(5, reposo),
            leve: Math.max(reposo + 5, leve),
            mvc: Math.max(leve + 5, mvc),
          });
          setVuCalStep("done");
          setVuCalProgress(1);
          setTimeout(() => setVuCalStep("idle"), 2000);
        }
      }
    }, 100);
  }, [serial.data]);

  // Metrics
  const recent = serial.data.slice(-100);
  const rms =
    recent.length > 0
      ? Math.sqrt(recent.reduce((sum, d) => sum + d.value * d.value, 0) / recent.length)
      : 0;
  const peak =
    recent.length > 0
      ? Math.max(...recent.map((d) => Math.abs(d.value)))
      : 0;

  const totalSeconds = serial.data.length >= 2
    ? (serial.data[serial.data.length - 1].timestamp_ms - serial.data[0].timestamp_ms) / 1000
    : 0;
  const totalMin = Math.floor(totalSeconds / 60);
  const totalSec = Math.floor(totalSeconds % 60);

  // Report
  const [reportOpen, setReportOpen] = useState(false);
  const emgCanvasRef = useRef<HTMLDivElement>(null);
  const [signalImage, setSignalImage] = useState("");

  const handleOpenReport = useCallback(() => {
    setSignalImage(captureCanvas(emgCanvasRef.current));
    setReportOpen(true);
  }, []);

  const emgReport: ReportData = useMemo(() => ({
    title: "Electromiograma",
    accent: "#f59e0b",
    fields: [
      { label: "RMS", value: rms > 0 ? rms.toFixed(1) : "\u2014", unit: "\u00B5V" },
      { label: "Amplitud pico", value: peak > 0 ? peak.toFixed(1) : "\u2014", unit: "\u00B5V" },
      { label: "Duración", value: totalSeconds > 0 ? `${totalMin}:${totalSec.toString().padStart(2, "0")}` : "\u2014", unit: "min:seg" },
      { label: "Muestras", value: serial.data.length.toString() },
      { label: "Offset", value: offsetMv.toFixed(1), unit: "mV" },
      { label: "Ganancia", value: adcConfig.gain.toString() },
      { label: "Calibración", value: isCalibrated ? "Calibrado" : "Por defecto (666 mV)" },
    ],
    signalImage,
    signalLabel: "Potencial muscular EMG (\u00B5V)",
  }), [rms, peak, serial.data.length, isCalibrated, offsetMv, signalImage, totalSeconds, totalMin, totalSec, adcConfig.gain]);

  // Marker stats for sidebar
  const markerStats = useMemo(() => {
    return phaseMarkers.map((m) => {
      const end = m.endMs ?? (serial.data.length > 0 ? serial.data[serial.data.length - 1].timestamp_ms : m.startMs);
      let peakVal = 0;
      let sumSq = 0;
      let count = 0;
      let mn = Infinity;
      let mx = -Infinity;
      for (const pt of serial.data) {
        if (pt.timestamp_ms < m.startMs) continue;
        if (pt.timestamp_ms > end) break;
        const abs = Math.abs(pt.value);
        if (abs > peakVal) peakVal = abs;
        if (pt.value < mn) mn = pt.value;
        if (pt.value > mx) mx = pt.value;
        sumSq += pt.value * pt.value;
        count++;
      }
      const rmsV = count > 0 ? Math.sqrt(sumSq / count) : 0;
      const amplitude = isFinite(mx) && isFinite(mn) ? mx - mn : 0;
      const dur = end - m.startMs;
      return { id: m.id, type: m.type, peak: peakVal, rms: rmsV, amplitude, dur, count, open: m.endMs === null };
    });
  }, [phaseMarkers, serial.data]);

  const statusText = !serial.isConnected
    ? "Desconectado"
    : serial.recording && !frozen
      ? "Recibiendo"
      : frozen ? "Congelado" : "Conectado";

  // ADC config handler
  const handleAdcChange = useCallback((field: keyof ADCConfig, value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num) && num > 0) {
      setAdcConfig(prev => ({ ...prev, [field]: num }));
    }
  }, []);

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden">
      <PageHeader
        title="Monitor EMG"
        icon={<BicepsFlexed className="h-5 w-5 text-emg-400" />}
        actions={<StatusBadge status={serial.isConnected ? "connected" : "disconnected"} />}
      />

      {/* Controls bar */}
      <Card className="mb-3">
        <CardContent className="flex flex-wrap items-center gap-3">
          <SerialSelect
            ports={serial.ports}
            selectedPort={serial.selectedPort}
            onPortChange={serial.setSelectedPort}
            onRefresh={serial.refreshPorts}
            disabled={serial.isConnected}
          />
          {serial.isConnected ? (
            <Button onClick={handleDisconnect} variant="danger">
              <PlugZap className="h-4 w-4 mr-1" />Desconectar
            </Button>
          ) : (
            <Button onClick={handleConnect} variant="primary">
              <Plug className="h-4 w-4 mr-1" />Conectar
            </Button>
          )}

          <div className="h-6 w-px bg-surface-600" />

          <Button onClick={handlePlayStop} disabled={!serial.isConnected} variant={serial.recording ? "danger" : "primary"}>
            {serial.recording ? (<><Pause className="h-4 w-4 mr-1" />Stop</>) : (<><Play className="h-4 w-4 mr-1" />Play</>)}
          </Button>
          <Button onClick={handleClearData} disabled={serial.data.length === 0} variant="ghost" title="Limpiar registro">
            <Trash2 className="h-4 w-4 mr-1" />Limpiar
          </Button>

          <div className="h-6 w-px bg-surface-600" />

          {/* Scale presets */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-secondary">Escala:</span>
            <button
              onClick={() => setScalePreset(null)}
              className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${scalePreset === null ? "bg-emg-500/30 text-emg-400 ring-1 ring-emg-500/40" : "bg-surface-700 text-secondary hover:text-primary"}`}
            >
              Auto
            </button>
            {SCALE_PRESETS.map(s => (
              <button
                key={s}
                onClick={() => setScalePreset(s)}
                className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${scalePreset === s ? "bg-emg-500/30 text-emg-400 ring-1 ring-emg-500/40" : "bg-surface-700 text-secondary hover:text-primary"}`}
              >
                \u00B1{s}
              </button>
            ))}
          </div>

          <div className="h-6 w-px bg-surface-600" />

          {/* Toggle buttons */}
          <button
            onClick={() => setShowRmsEnvelope(v => !v)}
            className={`px-2 py-0.5 text-[10px] rounded transition-colors ${showRmsEnvelope ? "bg-purple-500/20 text-purple-400 ring-1 ring-purple-500/40" : "bg-surface-700 text-secondary hover:text-primary"}`}
            title="Envolvente RMS"
          >
            <Activity className="h-3 w-3 inline mr-0.5" />RMS
          </button>

          {serial.error && <span className="text-xs text-red-400">{serial.error}</span>}
        </CardContent>
      </Card>

      {/* Chart + VU Meter + Sidebar */}
      <div className="grid grid-cols-[minmax(0,1fr)_220px] gap-3 flex-1 min-h-0">
        {/* Chart + VU Meter */}
        <div className="flex flex-col gap-3 min-h-0">
          <Card className="flex flex-col min-h-0 min-w-0 overflow-hidden flex-1">
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <span>Señal EMG</span>
                <button onClick={handleFreeze} disabled={!serial.isConnected && serial.data.length === 0}
                  className={`p-1.5 rounded transition-colors disabled:opacity-30 ${frozen ? "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40" : "bg-surface-700 text-secondary hover:text-primary"}`}
                  title={frozen ? "Descongelar" : "Congelar"}>
                  <Snowflake className="h-4 w-4" />
                </button>
              </div>
            </CardHeader>
            <CardContent className="flex-1 flex min-h-0">
              {/* VU Meter */}
              <div className="flex-shrink-0 mr-2">
                <VUMeter
                  rmsValue={rms}
                  thresholds={vuThresholds}
                  calibrationStep={vuCalStep}
                  calibrationProgress={vuCalProgress}
                  height={300}
                />
              </div>
              {/* Canvas */}
              <div ref={emgCanvasRef} className="flex-1 min-h-0 min-w-0">
                <EMGCanvas
                  data={serial.data}
                  frozen={frozen || !serial.recording}
                  markers={phaseMarkers}
                  activePhase={activePhase}
                  pendingStartMs={pendingStart}
                  onCanvasClick={handleCanvasClick}
                  onMarkerUpdate={handleMarkerUpdate}
                  scalePreset={scalePreset}
                  showRmsEnvelope={showRmsEnvelope}
                  showCalBar={showCalBar}
                  className="h-full"
                />
              </div>
            </CardContent>
          </Card>

          {/* Phase Comparison panel */}
          {showComparison && phaseMarkers.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between w-full">
                  <span className="text-xs">Comparación de fases</span>
                  <button
                    onClick={() => setShowComparison(false)}
                    className="text-[10px] text-secondary hover:text-primary"
                  >
                    Ocultar
                  </button>
                </div>
              </CardHeader>
              <CardContent>
                <PhaseComparison
                  data={serial.data}
                  markers={phaseMarkers}
                />
              </CardContent>
            </Card>
          )}

          {(frozen || !serial.recording) && serial.data.length > 0 && (
            <p className="text-xs text-secondary text-center">
              Rueda o arrastra para navegar | Arrastra bordes de marcador para ajustar
            </p>
          )}
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-3 overflow-auto min-h-0">
          {/* Metrics */}
          <Card>
            <CardContent>
              <div className="flex justify-between text-xs text-secondary mb-1">
                <span>Estado</span>
                <span className="font-medium text-emg-400">{statusText}</span>
              </div>
              <div className="flex justify-between text-xs text-secondary mb-1">
                <span>RMS</span>
                <span className="font-mono text-emg-400">{rms > 0 ? `${rms.toFixed(1)} \u00B5V` : "--"}</span>
              </div>
              <div className="flex justify-between text-xs text-secondary mb-1">
                <span>Pico</span>
                <span className="font-mono text-emg-400">{peak > 0 ? `${peak.toFixed(1)} \u00B5V` : "--"}</span>
              </div>
              <div className="flex justify-between text-xs text-secondary mb-1">
                <span>Muestras</span>
                <span className="font-mono text-emg-400">{serial.data.length}</span>
              </div>
              <div className="flex justify-between text-xs text-secondary">
                <span>Grabación</span>
                <span className="font-mono text-emg-400">{totalMin}:{totalSec.toString().padStart(2, "0")}</span>
              </div>
            </CardContent>
          </Card>

          {/* ADC Config */}
          <Card>
            <CardHeader>Parámetros ADC</CardHeader>
            <CardContent>
              <div className="flex flex-col gap-1.5">
                <div className="text-[9px] text-secondary mb-1 font-mono">
                  µV = ((raw - offset) × Vref / 2^bits) / G × 10⁶
                </div>
                {([
                  { key: "gain" as const, label: "Ganancia", unit: "" },
                  { key: "vref" as const, label: "Vref", unit: "mV/LSB" },
                  { key: "resolution" as const, label: "Resolución", unit: "bits" },
                  { key: "offset" as const, label: "Offset", unit: "mV" },
                ]).map(({ key, label, unit }) => (
                  <div key={key} className="flex items-center justify-between gap-1">
                    <span className="text-[10px] text-secondary">{label}</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={adcConfig[key]}
                        onChange={(e) => handleAdcChange(key, e.target.value)}
                        className="w-16 px-1 py-0.5 text-[10px] font-mono bg-surface-800 border border-surface-600 rounded text-primary text-right"
                        step={key === "vref" ? 0.001 : 1}
                      />
                      {unit && <span className="text-[9px] text-secondary">{unit}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Calibration */}
          <Card>
            <CardHeader>Calibración</CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-xs text-secondary">
                  <span>Offset</span>
                  <span className="font-mono text-emg-400">{offsetMv.toFixed(1)} mV</span>
                </div>
                <div className="flex justify-between text-xs text-secondary">
                  <span>Estado</span>
                  <span className={`font-medium ${isCalibrated ? "text-green-400" : "text-secondary"}`}>
                    {isCalibrated ? "Calibrado" : "Por defecto"}
                  </span>
                </div>
                {calibrationProgress > 0 && !isCalibrated && (
                  <div>
                    <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emg-500 rounded-full transition-all duration-100"
                        style={{ width: `${calibrationProgress * 100}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-secondary mt-0.5 text-center">
                      {Math.round(calibrationProgress * 100)}%
                    </div>
                  </div>
                )}
                <button
                  onClick={startCalibration}
                  disabled={!serial.isConnected || isCalibrated || calibrationProgress > 0}
                  className="w-full px-2 py-1.5 text-xs rounded bg-emg-500/20 text-emg-400 hover:bg-emg-500/30 disabled:opacity-30 transition-colors"
                >
                  {calibrationProgress > 0 && !isCalibrated
                    ? "Calibrando..."
                    : isCalibrated
                      ? "Calibrado"
                      : "Calibrar offset (5s)"}
                </button>
              </div>
            </CardContent>
          </Card>

          {/* VU Meter Calibration */}
          <Card>
            <CardHeader>Umbrales VU</CardHeader>
            <CardContent>
              <div className="flex flex-col gap-1.5">
                {([
                  { key: "reposo" as const, label: "Reposo", color: "#22c55e" },
                  { key: "leve" as const, label: "Leve", color: "#eab308" },
                  { key: "mvc" as const, label: "MVC", color: "#ef4444" },
                ]).map(({ key, label, color }) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-[10px]" style={{ color }}>{label}</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={vuThresholds[key].toFixed(0)}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v) && v > 0) setVuThresholds(prev => ({ ...prev, [key]: v }));
                        }}
                        className="w-14 px-1 py-0.5 text-[10px] font-mono bg-surface-800 border border-surface-600 rounded text-primary text-right"
                      />
                      <span className="text-[9px] text-secondary">\u00B5V</span>
                    </div>
                  </div>
                ))}
                <button
                  onClick={vuCalStep === "idle" ? startVuCalibration : stopVuCalibration}
                  disabled={!serial.recording}
                  className="w-full px-2 py-1.5 text-xs rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 disabled:opacity-30 transition-colors mt-1"
                >
                  {vuCalStep === "idle"
                    ? "Auto-calibrar (13s)"
                    : vuCalStep === "done"
                      ? "Calibrado"
                      : `Calibrando: ${vuCalStep === "reposo" ? "Reposo" : vuCalStep === "leve" ? "Leve" : "MVC"}...`}
                </button>
                {vuCalStep !== "idle" && vuCalStep !== "done" && (
                  <div className="text-[10px] text-center text-secondary">
                    {vuCalStep === "reposo" && "Relaje el músculo completamente..."}
                    {vuCalStep === "leve" && "Realice contracción leve..."}
                    {vuCalStep === "mvc" && "Contracción máxima voluntaria..."}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Phase markers */}
          <Card>
            <CardHeader>Fases</CardHeader>
            <CardContent>
              <div className="flex flex-col gap-1.5">
                {(Object.entries(EMG_PHASE_CONFIG) as [EMGPhaseType, typeof EMG_PHASE_CONFIG.reposo][]).map(([type, cfg]) => {
                  const isActive = activePhase === type;
                  const hasPending = isActive && pendingStart !== null;
                  return (
                    <button
                      key={type}
                      onClick={() => handlePhaseSelect(type)}
                      disabled={!frozen && serial.data.length === 0}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors disabled:opacity-30"
                      style={{
                        backgroundColor: isActive ? cfg.bg : undefined,
                        color: isActive ? cfg.color : undefined,
                        border: isActive ? `1px solid ${cfg.color}` : "1px solid transparent",
                      }}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: cfg.color, opacity: isActive ? 1 : 0.5 }}
                      />
                      <span className={isActive ? "font-medium" : "text-secondary"}>
                        {cfg.label}
                      </span>
                      {isActive && (
                        <span className="ml-auto text-[10px] opacity-70">
                          {hasPending ? "2do click" : "1er click"}
                        </span>
                      )}
                    </button>
                  );
                })}
                {markerStats.length > 0 && (
                  <>
                    <div className="h-px bg-surface-600 my-1" />
                    {markerStats.map((s) => {
                      const cfg = EMG_PHASE_CONFIG[s.type];
                      return (
                        <div key={s.id} className="rounded px-1.5 py-1 text-[10px]" style={{ borderLeft: `3px solid ${cfg.color}` }}>
                          <div className="flex justify-between">
                            <span style={{ color: cfg.color }} className="font-medium">{cfg.label}</span>
                            <span className="text-secondary">
                              {s.open ? "REC" : s.dur >= 1000 ? `${(s.dur / 1000).toFixed(1)}s` : `${s.dur.toFixed(0)}ms`}
                            </span>
                          </div>
                          {s.count > 0 && (
                            <div className="flex gap-2 text-secondary mt-0.5">
                              <span>P-P:<span className="font-mono text-primary ml-0.5">{s.amplitude.toFixed(1)}</span></span>
                              <span>RMS:<span className="font-mono text-primary ml-0.5">{s.rms.toFixed(1)}</span></span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div className="flex justify-between mt-1">
                      {!showComparison && phaseMarkers.length > 0 && (
                        <button
                          onClick={() => setShowComparison(true)}
                          className="text-[10px] text-purple-400 hover:text-purple-300 transition-colors"
                        >
                          Comparar fases
                        </button>
                      )}
                      <button
                        onClick={handleClearMarkers}
                        className="text-[10px] text-red-400 hover:text-red-300 transition-colors ml-auto"
                      >
                        Limpiar marcadores
                      </button>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Export */}
          <Card>
            <CardHeader>Exportar</CardHeader>
            <CardContent>
              <button
                onClick={handleOpenReport}
                disabled={serial.data.length < 2}
                className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 disabled:opacity-30 transition-colors"
              >
                <FileText className="h-3.5 w-3.5" />
                Vista previa informe
              </button>
            </CardContent>
          </Card>
        </div>
      </div>

      <ReportPreview open={reportOpen} onClose={() => setReportOpen(false)} report={emgReport} />
    </div>
  );
}
