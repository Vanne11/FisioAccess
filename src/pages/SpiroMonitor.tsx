import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Wind, Trash2, FileText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import { SerialSelect } from "@/components/shared/SerialSelect";
import { SignalChart } from "@/components/shared/SignalChart";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PageHeader } from "@/components/layout/PageHeader";
import { useSerial, type DataPoint } from "@/hooks/useSerial";
import { ReportPreview, type ReportData, captureSVG } from "@/components/shared/ReportPreview";

interface TestResult {
  id: number;
  name: string;
  duration: number;
  peakFlow: number;
  data: DataPoint[];
}

export function SpiroMonitor() {
  const serial = useSerial(115200, 600);
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [tests, setTests] = useState<TestResult[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const testStartRef = useRef<number>(0);
  const testDataRef = useRef<DataPoint[]>([]);

  const handleToggle = async () => {
    if (serial.isConnected) {
      await serial.disconnect();
      setIsCalibrated(false);
      stopTest();
    } else {
      await serial.connect();
    }
  };

  const handleCalibrate = () => {
    setTimeout(() => setIsCalibrated(true), 1000);
  };

  const stopTest = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;

    if (isTesting && testDataRef.current.length > 0) {
      const duration = Math.round((Date.now() - testStartRef.current) / 1000);
      const peak = Math.max(...testDataRef.current.map((d) => d.value), 0);
      setTests((prev) => [
        ...prev,
        {
          id: Date.now(),
          name: `Prueba ${prev.length + 1}`,
          duration,
          peakFlow: peak,
          data: [...testDataRef.current],
        },
      ]);
    }

    testDataRef.current = [];
    setIsTesting(false);
  };

  const handleStartTest = () => {
    serial.clearData();
    testDataRef.current = [];
    testStartRef.current = Date.now();
    setElapsed(0);
    setIsTesting(true);

    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - testStartRef.current) / 1000));
    }, 200);
  };

  // Capture test data from serial stream
  useEffect(() => {
    if (isTesting && serial.data.length > 0) {
      testDataRef.current = serial.data;
    }
  }, [isTesting, serial.data]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // --- Vista previa informe ---
  const [reportOpen, setReportOpen] = useState(false);
  const spiroChartRef = useRef<HTMLDivElement>(null);
  const [signalImage, setSignalImage] = useState("");

  const handleOpenReport = useCallback(async () => {
    const img = await captureSVG(spiroChartRef.current);
    setSignalImage(img);
    setReportOpen(true);
  }, []);

  const spiroReport: ReportData = useMemo(() => {
    const bestPEF = tests.length > 0 ? Math.max(...tests.map((t) => t.peakFlow)) : 0;
    const avgPEF = tests.length > 0 ? tests.reduce((s, t) => s + t.peakFlow, 0) / tests.length : 0;
    return {
      title: "Espirometria",
      accent: "#8b5cf6",
      fields: [
        { label: "Numero de pruebas", value: tests.length.toString() },
        ...(tests.length > 0
          ? [
              { label: "Mejor PEF", value: bestPEF.toFixed(1), unit: "L/s" },
              { label: "PEF promedio", value: avgPEF.toFixed(1), unit: "L/s" },
            ]
          : []),
        ...tests.map((t) => ({
          label: `${t.name} — Duracion`,
          value: `${t.duration}s | PEF: ${t.peakFlow.toFixed(1)}`,
          unit: "L/s",
        })),
      ],
      signalImage,
      signalLabel: "Curva flujo-volumen",
    };
  }, [tests, signalImage]);

  const getStatus = () => {
    if (isTesting) return "testing" as const;
    if (!serial.isConnected) return "disconnected" as const;
    if (isCalibrated) return "calibrated" as const;
    return "connected" as const;
  };

  return (
    <div>
      <PageHeader
        title="Espirometro"
        icon={<Wind className="h-5 w-5 text-spiro-400" />}
        actions={<StatusBadge status={getStatus()} />}
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-3">
          <SerialSelect
            ports={serial.ports}
            selectedPort={serial.selectedPort}
            onPortChange={serial.setSelectedPort}
            onRefresh={serial.refreshPorts}
            disabled={serial.isConnected}
          />
          <Button
            onClick={handleToggle}
            variant={serial.isConnected ? "danger" : "primary"}
          >
            {serial.isConnected ? "Desconectar" : "Conectar"}
          </Button>
          <Button
            onClick={handleCalibrate}
            disabled={!serial.isConnected || isCalibrated}
            variant="secondary"
          >
            {isCalibrated ? "Calibrado" : "Calibrar"}
          </Button>
          <Button
            onClick={isTesting ? stopTest : handleStartTest}
            disabled={!isCalibrated || !serial.isConnected}
            variant={isTesting ? "danger" : "primary"}
          >
            {isTesting ? "Detener" : "Iniciar Prueba"}
          </Button>
          {serial.error && (
            <span className="text-xs text-red-400">{serial.error}</span>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Card>
          <CardContent className="text-center">
            <div className="text-xs text-secondary mb-1">Tiempo</div>
            <div className="text-2xl font-bold text-spiro-400 font-mono">
              {isTesting ? `${elapsed}s` : "--"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="text-center">
            <div className="text-xs text-secondary mb-1">Estado</div>
            <div className="text-sm font-medium">
              <StatusBadge status={getStatus()} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="text-center">
            <div className="text-xs text-secondary mb-1">Pruebas</div>
            <div className="text-2xl font-bold text-spiro-400 font-mono">
              {tests.length}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-4">
        <CardHeader>
          {isTesting
            ? `Prueba en curso - ${elapsed}s`
            : "Curvas de flujo-volumen"}
        </CardHeader>
        <CardContent>
          <div ref={spiroChartRef}>
            <SignalChart data={serial.data} color="var(--color-spiro)" height={280} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>Pruebas Guardadas ({tests.length})</CardHeader>
        <CardContent>
          {tests.length === 0 ? (
            <p className="text-sm text-muted">No hay pruebas guardadas</p>
          ) : (
            <ul className="space-y-2">
              {tests.map((test) => (
                <li
                  key={test.id}
                  className="flex items-center justify-between p-2 rounded-lg hover:bg-surface-800 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-medium text-primary">
                      {test.name}
                    </span>
                    <span className="text-xs text-secondary">
                      {test.duration}s
                    </span>
                    <span className="text-xs text-spiro-400">
                      PEF: {test.peakFlow.toFixed(1)}
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      setTests((prev) => prev.filter((t) => t.id !== test.id))
                    }
                    className="p-1 text-muted hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end mt-4">
        <button
          onClick={handleOpenReport}
          disabled={tests.length === 0}
          className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 disabled:opacity-30 transition-colors"
        >
          <FileText className="h-3.5 w-3.5" />
          Vista previa informe
        </button>
      </div>

      <ReportPreview open={reportOpen} onClose={() => setReportOpen(false)} report={spiroReport} />
    </div>
  );
}
