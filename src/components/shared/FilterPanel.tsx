import type { FilterConfig } from "@/lib/dsp";

interface FilterPanelProps {
  config: FilterConfig;
  onChange: (config: FilterConfig) => void;
}

function Toggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`relative w-8 h-4 rounded-full transition-colors ${
        enabled ? "bg-ecg-500" : "bg-surface-600"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
          enabled ? "translate-x-4" : ""
        }`}
      />
    </button>
  );
}

function FreqSelector<T extends number>({
  options,
  value,
  onChange,
  unit,
  disabled,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  unit: string;
  disabled: boolean;
}) {
  return (
    <div className="flex gap-1 mt-1">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          disabled={disabled}
          className={`px-1.5 py-0.5 text-[10px] rounded font-mono transition-colors disabled:opacity-30 ${
            value === opt
              ? "bg-ecg-500/20 text-ecg-400 ring-1 ring-ecg-500/40"
              : "bg-surface-700 text-secondary hover:text-primary"
          }`}
        >
          {opt}
        </button>
      ))}
      <span className="text-[10px] text-secondary self-center">{unit}</span>
    </div>
  );
}

export function FilterPanel({ config, onChange }: FilterPanelProps) {
  const update = (partial: Partial<FilterConfig>) =>
    onChange({ ...config, ...partial });

  return (
    <div className="flex flex-col gap-3">
      {/* Notch */}
      <div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-primary font-medium">Notch</span>
          <Toggle
            enabled={config.notchEnabled}
            onToggle={() => update({ notchEnabled: !config.notchEnabled })}
          />
        </div>
        <FreqSelector
          options={[50, 60] as (50 | 60)[]}
          value={config.notchFreq}
          onChange={(v) => update({ notchFreq: v })}
          unit="Hz"
          disabled={!config.notchEnabled}
        />
      </div>

      <div className="h-px bg-surface-600" />

      {/* High-pass */}
      <div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-primary font-medium">Pasa-altos</span>
          <Toggle
            enabled={config.highpassEnabled}
            onToggle={() => update({ highpassEnabled: !config.highpassEnabled })}
          />
        </div>
        <FreqSelector
          options={[0.05, 0.5] as (0.05 | 0.5)[]}
          value={config.highpassFreq}
          onChange={(v) => update({ highpassFreq: v })}
          unit="Hz"
          disabled={!config.highpassEnabled}
        />
      </div>

      <div className="h-px bg-surface-600" />

      {/* Low-pass */}
      <div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-primary font-medium">Pasa-bajos</span>
          <Toggle
            enabled={config.lowpassEnabled}
            onToggle={() => update({ lowpassEnabled: !config.lowpassEnabled })}
          />
        </div>
        <FreqSelector
          options={[40, 150] as (40 | 150)[]}
          value={config.lowpassFreq}
          onChange={(v) => update({ lowpassFreq: v })}
          unit="Hz"
          disabled={!config.lowpassEnabled}
        />
      </div>
    </div>
  );
}
