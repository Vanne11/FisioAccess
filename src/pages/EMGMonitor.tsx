import { useState } from "react";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import { SerialSelect } from "@/components/shared/SerialSelect";
import { SignalChart } from "@/components/shared/SignalChart";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PageHeader } from "@/components/layout/PageHeader";
import { useSerial } from "@/hooks/useSerial";

export function EMGMonitor() {
  const serial = useSerial(115200, 500);
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);

  const handleToggle = async () => {
    if (serial.isConnected) {
      await serial.disconnect();
      setIsCalibrated(false);
      setCalibrationProgress(0);
    } else {
      await serial.connect();
    }
  };

  const startCalibration = () => {
    setCalibrationProgress(0.01);
    const interval = setInterval(() => {
      setCalibrationProgress((prev) => {
        if (prev >= 1) {
          clearInterval(interval);
          setIsCalibrated(true);
          return 0;
        }
        return prev + 0.02;
      });
    }, 100);
  };

  // Derive metrics from real data
  const recent = serial.data.slice(-100);
  const rms =
    recent.length > 0
      ? Math.sqrt(
          recent.reduce((sum, d) => sum + d.value * d.value, 0) / recent.length,
        )
      : null;
  const peak =
    recent.length > 0
      ? Math.max(...recent.map((d) => Math.abs(d.value)))
      : null;

  const getStatus = () => {
    if (!serial.isConnected) return "disconnected" as const;
    if (isCalibrated) return "calibrated" as const;
    return "connected" as const;
  };

  return (
    <div>
      <PageHeader
        title="Monitor EMG"
        icon={<Activity className="h-5 w-5 text-emg-400" />}
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
          {serial.error && (
            <span className="text-xs text-red-400">{serial.error}</span>
          )}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent>
          <div className="flex items-center gap-4">
            <StatusBadge
              status={isCalibrated ? "calibrated" : "disconnected"}
              label={isCalibrated ? "Calibrado" : "Sin calibrar"}
            />
            {calibrationProgress > 0 && !isCalibrated && (
              <div className="flex-1">
                <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emg-500 rounded-full transition-all duration-100"
                    style={{ width: `${calibrationProgress * 100}%` }}
                  />
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {Math.round(calibrationProgress * 100)}%
                </div>
              </div>
            )}
            <Button
              onClick={startCalibration}
              disabled={
                !serial.isConnected || isCalibrated || calibrationProgress > 0
              }
              variant={isCalibrated ? "secondary" : "primary"}
              size="sm"
            >
              {calibrationProgress > 0 && !isCalibrated
                ? "Calibrando..."
                : isCalibrated
                  ? "Calibrado"
                  : "Calibrar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <Card>
          <CardContent className="text-center">
            <div className="text-xs text-slate-500 mb-1">RMS (uV)</div>
            <div className="text-2xl font-bold text-emg-400 font-mono">
              {rms !== null ? rms.toFixed(1) : "--"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="text-center">
            <div className="text-xs text-slate-500 mb-1">Pico Max</div>
            <div className="text-2xl font-bold text-emg-400 font-mono">
              {peak !== null ? peak.toFixed(0) : "--"}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>Potencial Muscular EMG</CardHeader>
        <CardContent>
          <SignalChart data={serial.data} color="var(--color-emg)" height={300} />
        </CardContent>
      </Card>
    </div>
  );
}
