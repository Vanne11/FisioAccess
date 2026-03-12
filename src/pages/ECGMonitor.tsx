import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  Heart,
  Pause,
  Play,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Plug,
  PlugZap,
  Snowflake,
  Download,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import { SerialSelect } from "@/components/shared/SerialSelect";
import { ECGCanvas } from "@/components/shared/ECGCanvas";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { FilterPanel } from "@/components/shared/FilterPanel";
import { MarkerPanel } from "@/components/shared/MarkerPanel";
import { CalibrationPanel } from "@/components/shared/CalibrationPanel";
import { PageHeader } from "@/components/layout/PageHeader";
import { useSerial } from "@/hooks/useSerial";
import {
  type FilterConfig,
  DEFAULT_FILTER_CONFIG,
  applyFilterChain,
} from "@/lib/dsp";
import { detectRPeaks, calculateBPM } from "@/lib/peaks";
import {
  type ECGMarker,
  type MarkerToolType,
  POINT_TYPES,
  INTERVAL_TYPES,
  nextMarkerId,
  detectQRSComplexes,
} from "@/lib/markers";
import { exportECGAsPNG } from "@/lib/export";
import { SampleRateDetector } from "@/utils/sampleRateDetector";
import { detectADCType, calibrateFrom1mV, toMillivolts, adcToMvScale } from "@/utils/signalCalibrator";
import {
  useCalibrationStore,
  selectCalibrationConfig,
} from "@/stores/useCalibrationStore";

const SWEEP_OPTIONS = [12.5, 25, 50] as const;
const ZOOM_STEPS = [0.5, 1, 2, 4, 8] as const;
const BUFFER_SIZE = 50000;

export function ECGMonitor() {
  const serial = useSerial(115200, BUFFER_SIZE);
  const [sweepSpeed, setSweepSpeed] = useState<number>(25);
  const [frozen, setFrozen] = useState(false);
  const [zoomIdx, setZoomIdx] = useState(3);
  const [filterConfig, setFilterConfig] = useState<FilterConfig>(DEFAULT_FILTER_CONFIG);
  const [calibrating, setCalibrating] = useState(false);

  // Calibracion
  const calStore = useCalibrationStore();
  const calibration = useCalibrationStore(selectCalibrationConfig);

  // Sample rate detector
  const srDetectorRef = useRef(new SampleRateDetector());
  const [srInfo, setSrInfo] = useState(srDetectorRef.current.info);

  // Actualizar detector con cada muestra nueva
  useEffect(() => {
    const det = srDetectorRef.current;
    if (serial.data.length === 0) return;
    const last = serial.data[serial.data.length - 1];
    det.addSample(last.timestamp_ms);
    setSrInfo(det.info);
  }, [serial.data.length]);

  // Autodeteccion de ADC (una vez, con suficientes datos)
  useEffect(() => {
    if (calStore.autoDetected || serial.data.length < 50) return;
    const values = serial.data.slice(0, 200).map((d) => d.value);
    const result = detectADCType(values);
    if (result.confidence >= 0.6) {
      calStore.applyConfig({ adcBits: result.detectedBits });
      calStore.setAutoDetected(true);
    }
  }, [serial.data.length, calStore]);

  // Usar standardRate (estable) cuando esta disponible para evitar reinicio de filtros
  const sampleRate = srInfo.standardRate > 0 ? srInfo.standardRate : srInfo.rate;

  // Marcadores
  const [markers, setMarkers] = useState<ECGMarker[]>([]);
  const [activeTool, setActiveTool] = useState<MarkerToolType | null>(null);
  const [pendingIntervalStart, setPendingIntervalStart] = useState<number | null>(null);

  const zoom = ZOOM_STEPS[zoomIdx];

  // --- Filtrado + conversion a mV ---
  const filteredData = useMemo(() => {
    const raw = serial.data;
    if (raw.length < 10) {
      return raw.map((d) => ({ timestamp_ms: d.timestamp_ms, value: toMillivolts(d.value, calibration) }));
    }
    const anyOn = filterConfig.notchEnabled || filterConfig.highpassEnabled || filterConfig.lowpassEnabled;
    if (!anyOn) {
      return raw.map((d) => ({ timestamp_ms: d.timestamp_ms, value: toMillivolts(d.value, calibration) }));
    }
    const fs = sampleRate > 10 ? sampleRate : 250;
    const values = raw.map((d) => d.value);
    const filtered = applyFilterChain(values, fs, filterConfig);
    if (filterConfig.highpassEnabled) {
      const scale = adcToMvScale(calibration);
      return raw.map((d, i) => ({ timestamp_ms: d.timestamp_ms, value: filtered[i] * scale }));
    } else {
      return raw.map((d, i) => ({ timestamp_ms: d.timestamp_ms, value: toMillivolts(filtered[i], calibration) }));
    }
  }, [serial.data, filterConfig, sampleRate, calibration]);

  // --- R-peaks y BPM ---
  const rPeaks = useMemo(() => detectRPeaks(filteredData), [filteredData]);
  const bpm = useMemo(() => calculateBPM(rPeaks), [rPeaks]);

  // --- Complejos QRS ---
  const qrsComplexes = useMemo(() => detectQRSComplexes(markers), [markers]);

  // --- Conexion ---
  const handleConnect = async () => {
    setFrozen(false);
    await serial.connect();
  };

  const handleDisconnect = async () => {
    serial.stopRecording();
    await serial.disconnect();
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
    srDetectorRef.current.reset();
    setFrozen(false);
    setMarkers([]);
  }, [serial]);

  const handleFreeze = useCallback(() => setFrozen((f) => !f), []);
  const handleZoomIn = useCallback(() => setZoomIdx((i) => Math.min(i + 1, ZOOM_STEPS.length - 1)), []);
  const handleZoomOut = useCallback(() => setZoomIdx((i) => Math.max(i - 1, 0)), []);
  const handleZoomReset = useCallback(() => setZoomIdx(3), []);

  // --- Marcaje ---
  const handleCanvasClick = useCallback(
    (timestamp_ms: number) => {
      if (!activeTool) return;
      const isPoint = (POINT_TYPES as readonly string[]).includes(activeTool);
      const isInterval = (INTERVAL_TYPES as readonly string[]).includes(activeTool);

      if (isPoint) {
        setMarkers((prev) => [
          ...prev,
          { id: nextMarkerId(), kind: "point", type: activeTool as any, timestamp_ms },
        ]);
      } else if (isInterval) {
        if (pendingIntervalStart === null) {
          setPendingIntervalStart(timestamp_ms);
        } else {
          const startMs = Math.min(pendingIntervalStart, timestamp_ms);
          const endMs = Math.max(pendingIntervalStart, timestamp_ms);
          setMarkers((prev) => [
            ...prev,
            { id: nextMarkerId(), kind: "interval", type: activeTool as any, startMs, endMs },
          ]);
          setPendingIntervalStart(null);
        }
      }
    },
    [activeTool, pendingIntervalStart],
  );

  const handleToolChange = useCallback((tool: MarkerToolType | null) => {
    setActiveTool(tool);
    setPendingIntervalStart(null);
  }, []);

  const handleDeleteMarker = useCallback((id: string) => {
    setMarkers((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const handleClearMarkers = useCallback(() => {
    setMarkers([]);
    setPendingIntervalStart(null);
  }, []);

  // --- Calibracion 1mV ---
  const handleCalibrate1mV = useCallback(() => {
    if (serial.data.length < 50) return;
    setCalibrating(true);
    const values = serial.data.slice(-500).map((d) => d.value);
    const factor = calibrateFrom1mV(values, calibration);
    calStore.setCalibrationFactor(factor);
    setCalibrating(false);
  }, [serial.data, calibration, calStore]);

  // --- Exportar PNG ---
  const [exporting, setExporting] = useState(false);
  const [exportSeconds, setExportSeconds] = useState(0);

  const handleExport = useCallback(async (includeMarkers: boolean) => {
    if (filteredData.length < 2) return;
    setExporting(true);
    try {
      let exportData = filteredData;
      let exportMarkers = markers;
      let exportRPeaks = rPeaks;
      let exportQrs = qrsComplexes;

      if (exportSeconds > 0 && filteredData.length >= 2) {
        const lastTs = filteredData[filteredData.length - 1].timestamp_ms;
        const cutoff = lastTs - exportSeconds * 1000;
        exportData = filteredData.filter((d) => d.timestamp_ms >= cutoff);
        if (includeMarkers) {
          exportMarkers = markers.filter((m) =>
            m.kind === "point" ? m.timestamp_ms >= cutoff : m.startMs >= cutoff,
          );
          exportRPeaks = rPeaks.filter((p) => p.timestamp_ms >= cutoff);
          exportQrs = qrsComplexes.filter((q) => q.qMs >= cutoff);
        }
      }

      await exportECGAsPNG({
        data: exportData,
        sweepSpeed,
        markers: exportMarkers,
        qrsComplexes: exportQrs,
        rPeaks: exportRPeaks,
        bpm,
        sampleRate,
        calibration,
        includeMarkers,
      });
    } catch (err) {
      console.error("Export error:", err);
    } finally {
      setExporting(false);
    }
  }, [filteredData, sweepSpeed, markers, qrsComplexes, rPeaks, bpm, sampleRate, calibration, exportSeconds]);

  // --- Metricas ---
  const lastValue = serial.data.length > 0 ? serial.data[serial.data.length - 1].value : null;
  const totalSeconds = serial.data.length >= 2
    ? (serial.data[serial.data.length - 1].timestamp_ms - serial.data[0].timestamp_ms) / 1000
    : 0;
  const totalMin = Math.floor(totalSeconds / 60);
  const totalSec = Math.floor(totalSeconds % 60);
  const statusText = !serial.isConnected
    ? "Desconectado"
    : serial.recording && !frozen
      ? "Recibiendo"
      : frozen ? "Congelado" : "Conectado";

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden">
      <PageHeader
        title="Monitor ECG"
        icon={<Heart className="h-5 w-5 text-ecg-400" />}
        actions={
          <StatusBadge status={serial.isConnected ? "connected" : "disconnected"} />
        }
      />

      {/* Barra de controles */}
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

          <label className="text-xs text-secondary">Velocidad:</label>
          <div className="flex gap-1">
            {SWEEP_OPTIONS.map((s) => (
              <button key={s} onClick={() => setSweepSpeed(s)}
                className={`px-2 py-1 text-xs rounded font-mono transition-colors ${sweepSpeed === s ? "bg-ecg-500/20 text-ecg-400 ring-1 ring-ecg-500/40" : "bg-surface-700 text-secondary hover:text-primary"}`}
              >{s}</button>
            ))}
            <span className="text-xs text-secondary self-center ml-1">mm/s</span>
          </div>

          {serial.error && <span className="text-xs text-red-400">{serial.error}</span>}
        </CardContent>
      </Card>

      {/* Grafico + Panel lateral */}
      <div className="grid grid-cols-[minmax(0,1fr)_200px] gap-3 flex-1 min-h-0">
        {/* Canvas */}
        <Card className="flex flex-col min-h-0 min-w-0 overflow-hidden">
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <span>Senal ECG</span>
              <div className="flex items-center gap-1">
                <button onClick={handleFreeze} disabled={!serial.isConnected && serial.data.length === 0}
                  className={`p-1.5 rounded transition-colors disabled:opacity-30 ${frozen ? "bg-cyan-500/20 text-cyan-400 ring-1 ring-cyan-500/40" : "bg-surface-700 text-secondary hover:text-primary"}`}
                  title={frozen ? "Descongelar" : "Congelar"}>
                  <Snowflake className="h-4 w-4" />
                </button>
                <div className="w-px h-5 bg-surface-600 mx-1" />
                <button onClick={handleZoomOut} disabled={zoomIdx === 0}
                  className="p-1.5 rounded bg-surface-700 text-secondary hover:text-primary disabled:opacity-30 transition-colors" title="Zoom out">
                  <ZoomOut className="h-4 w-4" />
                </button>
                <span className="text-xs font-mono text-secondary min-w-[3ch] text-center">{zoom}x</span>
                <button onClick={handleZoomIn} disabled={zoomIdx === ZOOM_STEPS.length - 1}
                  className="p-1.5 rounded bg-surface-700 text-secondary hover:text-primary disabled:opacity-30 transition-colors" title="Zoom in">
                  <ZoomIn className="h-4 w-4" />
                </button>
                <button onClick={handleZoomReset}
                  className="p-1.5 rounded bg-surface-700 text-secondary hover:text-primary transition-colors" title="Reset zoom">
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col min-h-0">
            <ECGCanvas
              data={filteredData}
              sweepSpeed={sweepSpeed}
              frozen={frozen || !serial.recording}
              zoom={zoom}
              markers={markers}
              qrsComplexes={qrsComplexes}
              rPeaks={rPeaks}
              activeTool={activeTool}
              onCanvasClick={handleCanvasClick}
              calibration={calibration}
              sampleRate={sampleRate}
              className="flex-1 min-h-0"
            />
            {(frozen || !serial.recording) && serial.data.length > 0 && (
              <p className="text-xs text-secondary mt-1 text-center">
                {activeTool ? `Herramienta: ${activeTool} — click para marcar` : "Rueda o arrastra para navegar"}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Panel lateral */}
        <div className="flex flex-col gap-3 overflow-auto min-h-0">
          {/* BPM */}
          <Card>
            <CardContent className="text-center">
              <div className="flex items-center justify-center gap-2">
                <Heart className="h-5 w-5 text-red-500" />
                <div className="text-3xl font-bold text-red-500 font-mono">
                  {bpm > 0 ? bpm.toFixed(0) : "--"}
                </div>
              </div>
              <div className="text-[10px] text-secondary mt-1">BPM</div>
            </CardContent>
          </Card>

          {/* Metricas */}
          <Card>
            <CardContent>
              <div className="flex justify-between text-xs text-secondary mb-1">
                <span>Estado</span>
                <span className="font-medium text-ecg-400">{statusText}</span>
              </div>
              <div className="flex justify-between text-xs text-secondary mb-1">
                <span>Valor</span>
                <span className="font-mono text-ecg-400">{lastValue !== null ? lastValue.toFixed(0) : "--"}</span>
              </div>
              <div className="flex justify-between text-xs text-secondary mb-1">
                <span>Muestras</span>
                <span className="font-mono text-ecg-400">{serial.data.length}</span>
              </div>
              <div className="flex justify-between text-xs text-secondary mb-1">
                <span>Grabacion</span>
                <span className="font-mono text-ecg-400">{totalMin}:{totalSec.toString().padStart(2, "0")}</span>
              </div>
              <div className="flex justify-between text-xs text-secondary">
                <span>Fs</span>
                <span className="font-mono text-ecg-400">
                  {sampleRate > 0 ? `${sampleRate.toFixed(0)} Hz` : "--"}
                  {srInfo.calibrated && <span className="text-green-400 ml-1" title={`Confianza: ${(srInfo.confidence * 100).toFixed(0)}%`}>●</span>}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Filtros */}
          <Card>
            <CardHeader>Filtros</CardHeader>
            <CardContent>
              <FilterPanel config={filterConfig} onChange={setFilterConfig} />
            </CardContent>
          </Card>

          {/* Calibracion */}
          <Card>
            <CardHeader>Calibracion</CardHeader>
            <CardContent>
              <CalibrationPanel
                onCalibrate1mV={handleCalibrate1mV}
                calibrating={calibrating}
              />
            </CardContent>
          </Card>

          {/* Marcadores */}
          <Card>
            <CardHeader>Marcaje</CardHeader>
            <CardContent>
              <MarkerPanel
                activeTool={activeTool}
                onToolChange={handleToolChange}
                markers={markers}
                qrsComplexes={qrsComplexes}
                onDeleteMarker={handleDeleteMarker}
                onClearMarkers={handleClearMarkers}
                pendingInterval={pendingIntervalStart !== null}
              />
            </CardContent>
          </Card>

          {/* Exportar */}
          <Card>
            <CardHeader>Exportar</CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                <div className="text-[10px] text-secondary uppercase tracking-wider">
                  Duracion
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {[0, 10, 30, 60, 120, 300].map((s) => (
                    <button
                      key={s}
                      onClick={() => setExportSeconds(s)}
                      className={`px-1.5 py-1 text-[10px] rounded font-mono transition-colors ${
                        exportSeconds === s
                          ? "bg-ecg-500/20 text-ecg-400 ring-1 ring-ecg-500/40"
                          : "bg-surface-700 text-secondary hover:text-primary"
                      }`}
                    >
                      {s === 0 ? "Todo" : s < 60 ? `${s}s` : `${s / 60}m`}
                    </button>
                  ))}
                </div>
                {exportSeconds > 0 && (
                  <p className="text-[10px] text-secondary text-center">
                    Ultimos {exportSeconds < 60 ? `${exportSeconds}s` : `${exportSeconds / 60}m`}
                  </p>
                )}

                <div className="h-px bg-surface-600" />

                <button
                  onClick={() => handleExport(true)}
                  disabled={exporting || filteredData.length < 2}
                  className="flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded bg-ecg-500/20 text-ecg-400 hover:bg-ecg-500/30 disabled:opacity-30 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  Con marcas
                </button>
                <button
                  onClick={() => handleExport(false)}
                  disabled={exporting || filteredData.length < 2}
                  className="flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded bg-surface-700 text-secondary hover:text-primary disabled:opacity-30 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  Limpio
                </button>
                {exporting && (
                  <p className="text-[10px] text-ecg-400 text-center">Exportando...</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
