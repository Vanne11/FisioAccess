import { useCalibrationStore } from "@/stores/useCalibrationStore";
import type { ADCResolution } from "@/utils/signalCalibrator";

const ADC_OPTIONS: { label: string; value: ADCResolution }[] = [
  { label: "mV", value: 0 },
  { label: "10b", value: 10 },
  { label: "12b", value: 12 },
  { label: "14b", value: 14 },
  { label: "16b", value: 16 },
];

const VREF_OPTIONS = [3.3, 5.0] as const;
const GAIN_OPTIONS = [100, 500, 1000, 1100] as const;

interface CalibrationPanelProps {
  onCalibrate1mV?: () => void;
  calibrating?: boolean;
}

export function CalibrationPanel({ onCalibrate1mV, calibrating }: CalibrationPanelProps) {
  const store = useCalibrationStore();

  const btnClass = (active: boolean) =>
    `px-1.5 py-1 text-[10px] rounded font-mono transition-colors ${
      active
        ? "bg-ecg-500/20 text-ecg-400 ring-1 ring-ecg-500/40"
        : "bg-surface-700 text-secondary hover:text-primary"
    }`;

  return (
    <div className="flex flex-col gap-2">
      {/* ADC */}
      <div className="text-[10px] text-secondary uppercase tracking-wider">ADC</div>
      <div className="grid grid-cols-5 gap-1">
        {ADC_OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => store.setADCBits(o.value)}
            className={btnClass(store.adcBits === o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>

      {store.adcBits > 0 && (
        <>
          {/* Vref */}
          <div className="text-[10px] text-secondary uppercase tracking-wider">Vref</div>
          <div className="grid grid-cols-2 gap-1">
            {VREF_OPTIONS.map((v) => (
              <button key={v} onClick={() => store.setVRef(v)} className={btnClass(store.vRef === v)}>
                {v}V
              </button>
            ))}
          </div>

          {/* Ganancia HW */}
          <div className="text-[10px] text-secondary uppercase tracking-wider">Ganancia HW</div>
          <div className="grid grid-cols-4 gap-1">
            {GAIN_OPTIONS.map((g) => (
              <button key={g} onClick={() => store.setHWGain(g)} className={btnClass(store.hwGain === g)}>
                {g}x
              </button>
            ))}
          </div>
        </>
      )}

      <div className="h-px bg-surface-600" />

      {/* Calibrar con 1mV */}
      {onCalibrate1mV && (
        <button
          onClick={onCalibrate1mV}
          disabled={calibrating}
          className="px-2 py-1.5 text-[10px] rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 disabled:opacity-40 transition-colors"
        >
          {calibrating ? "Calibrando..." : "Calibrar con 1mV"}
        </button>
      )}

      {/* Reset */}
      <button
        onClick={store.reset}
        className="px-2 py-1 text-[10px] rounded bg-surface-700 text-secondary hover:text-primary transition-colors"
      >
        Reset calibracion
      </button>

      {/* Estado */}
      <div className="text-[10px] text-secondary text-center">
        {store.isCalibrated ? (
          <span className="text-green-400">Calibrado (x{store.calibrationFactor.toFixed(2)})</span>
        ) : (
          <span>Sin calibrar</span>
        )}
      </div>
    </div>
  );
}
