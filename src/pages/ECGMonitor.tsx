import { Heart } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import { SerialSelect } from "@/components/shared/SerialSelect";
import { SignalChart } from "@/components/shared/SignalChart";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PageHeader } from "@/components/layout/PageHeader";
import { useSerial } from "@/hooks/useSerial";

export function ECGMonitor() {
  const serial = useSerial(115200, 500);

  const handleToggle = async () => {
    if (serial.isConnected) {
      await serial.disconnect();
    } else {
      await serial.connect();
    }
  };

  // Derive metrics from real data
  const lastValue = serial.data.length > 0
    ? serial.data[serial.data.length - 1].value
    : null;

  return (
    <div>
      <PageHeader
        title="Monitor ECG"
        icon={<Heart className="h-5 w-5 text-ecg-400" />}
        actions={
          <StatusBadge
            status={serial.isConnected ? "connected" : "disconnected"}
          />
        }
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

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Card>
          <CardContent className="text-center">
            <div className="text-xs text-slate-500 mb-1">Ultimo valor</div>
            <div className="text-2xl font-bold text-ecg-400 font-mono">
              {lastValue !== null ? lastValue.toFixed(1) : "--"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="text-center">
            <div className="text-xs text-slate-500 mb-1">Muestras</div>
            <div className="text-2xl font-bold text-ecg-400 font-mono">
              {serial.data.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="text-center">
            <div className="text-xs text-slate-500 mb-1">Estado</div>
            <div className="text-sm font-medium text-ecg-400">
              {serial.isConnected ? "Recibiendo" : "--"}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>Senal ECG</CardHeader>
        <CardContent>
          <SignalChart data={serial.data} color="var(--color-ecg)" height={300} />
        </CardContent>
      </Card>
    </div>
  );
}
