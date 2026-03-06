import { RefreshCw } from "lucide-react";

interface SerialSelectProps {
  ports: string[];
  selectedPort: string;
  onPortChange: (port: string) => void;
  onRefresh: () => void;
  disabled?: boolean;
}

export function SerialSelect({
  ports,
  selectedPort,
  onPortChange,
  onRefresh,
  disabled,
}: SerialSelectProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs font-medium text-slate-400">Puerto:</label>
      <select
        value={selectedPort}
        onChange={(e) => onPortChange(e.target.value)}
        disabled={disabled || ports.length === 0}
        className="rounded-lg border border-surface-600 bg-surface-900 px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40"
      >
        {ports.length === 0 ? (
          <option value="">Sin puertos</option>
        ) : (
          ports.map((port) => (
            <option key={port} value={port}>
              {port}
            </option>
          ))
        )}
      </select>
      <button
        onClick={onRefresh}
        disabled={disabled}
        className="rounded-lg p-1.5 text-slate-400 hover:bg-surface-700 hover:text-slate-200 disabled:opacity-40 transition-colors"
      >
        <RefreshCw className="h-4 w-4" />
      </button>
    </div>
  );
}
