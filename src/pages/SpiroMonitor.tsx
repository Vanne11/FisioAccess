import { useState, useEffect, useRef } from "react";
import { Wind, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import { SerialSelect } from "@/components/shared/SerialSelect";
import { SignalChart } from "@/components/shared/SignalChart";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PageHeader } from "@/components/layout/PageHeader";
import { useSerial, type DataPoint } from "@/hooks/useSerial";

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
            <div className="text-xs text-slate-500 mb-1">Tiempo</div>
            <div className="text-2xl font-bold text-spiro-400 font-mono">
              {isTesting ? `${elapsed}s` : "--"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="text-center">
            <div className="text-xs text-slate-500 mb-1">Estado</div>
            <div className="text-sm font-medium">
              <StatusBadge status={getStatus()} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="text-center">
            <div className="text-xs text-slate-500 mb-1">Pruebas</div>
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
          <SignalChart data={serial.data} color="var(--color-spiro)" height={280} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>Pruebas Guardadas ({tests.length})</CardHeader>
        <CardContent>
          {tests.length === 0 ? (
            <p className="text-sm text-slate-600">No hay pruebas guardadas</p>
          ) : (
            <ul className="space-y-2">
              {tests.map((test) => (
                <li
                  key={test.id}
                  className="flex items-center justify-between p-2 rounded-lg hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-medium text-slate-200">
                      {test.name}
                    </span>
                    <span className="text-xs text-slate-500">
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
                    className="p-1 text-slate-600 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
