import { Trash2 } from "lucide-react";
import {
  POINT_TYPES,
  INTERVAL_TYPES,
  type MarkerToolType,
  type ECGMarker,
  type QRSComplex,
  MARKER_COLORS,
  QRS_COLOR,
} from "@/lib/markers";

interface MarkerPanelProps {
  activeTool: MarkerToolType | null;
  onToolChange: (tool: MarkerToolType | null) => void;
  markers: ECGMarker[];
  qrsComplexes: QRSComplex[];
  onDeleteMarker: (id: string) => void;
  onClearMarkers: () => void;
  pendingInterval: boolean;
}

export function MarkerPanel({
  activeTool,
  onToolChange,
  markers,
  qrsComplexes,
  onDeleteMarker,
  onClearMarkers,
  pendingInterval,
}: MarkerPanelProps) {
  const toggle = (tool: MarkerToolType) => {
    onToolChange(activeTool === tool ? null : tool);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Ondas */}
      <div className="text-[10px] text-secondary uppercase tracking-wider">
        Ondas
      </div>
      <div className="grid grid-cols-3 gap-1">
        {POINT_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => toggle(t)}
            className={`px-2 py-1 text-xs rounded font-mono font-bold transition-colors ${
              activeTool === t
                ? "ring-1 ring-offset-1 ring-offset-surface-800"
                : "bg-surface-700 text-secondary hover:text-primary"
            }`}
            style={
              activeTool === t
                ? { backgroundColor: MARKER_COLORS[t] + "30", color: MARKER_COLORS[t] }
                : undefined
            }
          >
            {t}
          </button>
        ))}
      </div>

      <div className="h-px bg-surface-600" />

      {/* Intervalos */}
      <div className="text-[10px] text-secondary uppercase tracking-wider">
        Intervalos
      </div>
      <div className="grid grid-cols-2 gap-1">
        {INTERVAL_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => toggle(t)}
            className={`px-2 py-1 text-xs rounded font-mono font-bold transition-colors ${
              activeTool === t
                ? "ring-1 ring-offset-1 ring-offset-surface-800"
                : "bg-surface-700 text-secondary hover:text-primary"
            }`}
            style={
              activeTool === t
                ? { backgroundColor: MARKER_COLORS[t] + "30", color: MARKER_COLORS[t] }
                : undefined
            }
          >
            {t}
          </button>
        ))}
      </div>

      {pendingInterval && (
        <p className="text-[10px] text-yellow-400 text-center">
          Click en el punto final
        </p>
      )}

      {/* QRS complejos detectados */}
      {qrsComplexes.length > 0 && (
        <>
          <div className="h-px bg-surface-600" />
          <div className="text-[10px] text-secondary uppercase tracking-wider">
            Complejos QRS ({qrsComplexes.length})
          </div>
          <div className="flex flex-col gap-0.5">
            {qrsComplexes.map((qrs, i) => (
              <div
                key={`qrs-${i}`}
                className="flex flex-col px-1.5 py-1 rounded text-[10px]"
                style={{ backgroundColor: QRS_COLOR + "15" }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold" style={{ color: QRS_COLOR }}>
                    QRS #{i + 1}
                  </span>
                  <span className="font-mono font-bold" style={{ color: QRS_COLOR }}>
                    {qrs.durationMs.toFixed(0)} ms
                  </span>
                </div>
                <div className="flex gap-2 mt-0.5 text-secondary">
                  <span>
                    <span style={{ color: MARKER_COLORS.Q }}>Q</span>{" "}
                    {(qrs.qMs / 1000).toFixed(2)}s
                  </span>
                  <span>
                    <span style={{ color: MARKER_COLORS.R }}>R</span>{" "}
                    {(qrs.rMs / 1000).toFixed(2)}s
                  </span>
                  <span>
                    <span style={{ color: MARKER_COLORS.S }}>S</span>{" "}
                    {(qrs.sMs / 1000).toFixed(2)}s
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="h-px bg-surface-600" />

      {/* Lista de marcadores */}
      <div className="text-[10px] text-secondary uppercase tracking-wider flex items-center justify-between">
        <span>Marcas ({markers.length})</span>
        {markers.length > 0 && (
          <button
            onClick={onClearMarkers}
            className="text-red-400 hover:text-red-300 transition-colors"
            title="Borrar todas"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="flex flex-col gap-0.5 max-h-[140px] overflow-auto">
        {markers.length === 0 && (
          <p className="text-[10px] text-secondary text-center py-1">
            Sin marcas
          </p>
        )}
        {markers.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between text-[10px] px-1.5 py-0.5 rounded bg-surface-700/50 group"
          >
            <span className="font-mono font-bold" style={{ color: MARKER_COLORS[m.type] }}>
              {m.type}
            </span>
            <span className="text-secondary font-mono">
              {m.kind === "point"
                ? `${(m.timestamp_ms / 1000).toFixed(2)}s`
                : `${(m.endMs - m.startMs).toFixed(0)}ms`}
            </span>
            <button
              onClick={() => onDeleteMarker(m.id)}
              className="text-secondary hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
