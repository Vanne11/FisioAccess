/**
 * ProtocolRunner — Modo de protocolo guiado para EMG.
 *
 * Flujo de marcado automático de fases:
 * ──────────────────────────────────────
 * 1. El usuario pulsa "Iniciar protocolo".
 * 2. Se muestra una cuenta regresiva de 3 s (estado "countdown").
 * 3. Se recorre la secuencia de fases (reposo → leve → máxima → relajación).
 *    Por cada fase un setInterval de 1 s controla el tiempo y emite:
 *      • phase-start  → al comenzar la fase (el padre guarda el timestamp).
 *      • phase-end    → al cumplirse la duración (el padre crea el marcador).
 * 4. Al terminar todas las fases se emite protocol-end; el padre congela
 *    el gráfico y abre la comparación.
 *
 * Los timestamps usados son los del último dato recibido del sensor
 * (serial.data[last].timestamp_ms), NO Date.now(), para que los marcadores
 * coincidan exactamente con la señal grabada.
 *
 * Para modificar el protocolo:
 *  - Cambiar DEFAULT_PROTOCOL para ajustar fases, duraciones o instrucciones.
 *  - Las duraciones también son editables en runtime desde el panel de config.
 *  - Para agregar nuevas fases, añadir el tipo en EMGPhaseType (EMGCanvas.tsx)
 *    y su config en EMG_PHASE_CONFIG, luego agregarlo a DEFAULT_PROTOCOL.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Square, SkipForward, Settings2 } from "lucide-react";
import { EMG_PHASE_CONFIG, type EMGPhaseType } from "./EMGCanvas";

export interface ProtocolStep {
  phase: EMGPhaseType;
  durationSec: number;
  instruction: string;
}

export const DEFAULT_PROTOCOL: ProtocolStep[] = [
  { phase: "reposo", durationSec: 5, instruction: "Mantenga el musculo en reposo completo" },
  { phase: "leve", durationSec: 5, instruction: "Realice una contraccion leve y sostenida" },
  { phase: "maxima", durationSec: 3, instruction: "Contraccion maxima voluntaria" },
  { phase: "relajacion", durationSec: 5, instruction: "Relaje el musculo completamente" },
];

export type ProtocolState = "idle" | "countdown" | "running" | "finished";

export interface ProtocolEvent {
  type: "phase-start" | "phase-end" | "protocol-end";
  phase: EMGPhaseType;
  stepIndex: number;
  timestampMs: number;
  /** True when the user wants recording to stop after protocol ends */
  autoStop?: boolean;
}

interface ProtocolRunnerProps {
  running: boolean;
  onStart: () => void;
  onStop: () => void;
  onPhaseEvent: (event: ProtocolEvent) => void;
  /** Must be true (recording + connected) to allow start */
  canStart: boolean;
  /** Current data timestamp for marker alignment */
  currentTimestampMs: number;
}

const COUNTDOWN_SEC = 3;

export function ProtocolRunner({
  running,
  onStart,
  onStop,
  onPhaseEvent,
  canStart,
  currentTimestampMs,
}: ProtocolRunnerProps) {
  const [protocol, setProtocol] = useState<ProtocolStep[]>(DEFAULT_PROTOCOL);
  const [state, setState] = useState<ProtocolState>("idle");
  const [stepIndex, setStepIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0); // seconds elapsed in current step/countdown
  const [countdownLeft, setCountdownLeft] = useState(0);
  const [showConfig, setShowConfig] = useState(false);
  const [autoStop, setAutoStop] = useState(true);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTsRef = useRef(0);
  const phaseStartTsRef = useRef(0);

  // Refs for stable access in interval callbacks
  const currentTsRef = useRef(currentTimestampMs);
  currentTsRef.current = currentTimestampMs;
  const onPhaseEventRef = useRef(onPhaseEvent);
  onPhaseEventRef.current = onPhaseEvent;
  const protocolRef = useRef(protocol);
  protocolRef.current = protocol;
  const autoStopRef = useRef(autoStop);
  autoStopRef.current = autoStop;
  const beginStepRef = useRef<(idx: number) => void>(() => {});

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => clearTimer, [clearTimer]);

  // Reset when externally stopped
  useEffect(() => {
    if (!running && state !== "idle") {
      clearTimer();
      setState("idle");
      setStepIndex(0);
      setElapsed(0);
      setCountdownLeft(0);
    }
  }, [running, state, clearTimer]);

  // Core step logic — assigned to ref so interval callbacks always get the latest
  const beginStep = useCallback((idx: number) => {
    const proto = protocolRef.current;
    if (idx >= proto.length) {
      setState("finished");
      onPhaseEventRef.current({ type: "protocol-end", phase: proto[proto.length - 1].phase, stepIndex: idx - 1, timestampMs: currentTsRef.current, autoStop: autoStopRef.current });
      clearTimer();
      return;
    }

    setState("running");
    setStepIndex(idx);
    setElapsed(0);
    phaseStartTsRef.current = currentTsRef.current;

    onPhaseEventRef.current({ type: "phase-start", phase: proto[idx].phase, stepIndex: idx, timestampMs: currentTsRef.current });

    const duration = proto[idx].durationSec;
    let sec = 0;
    clearTimer();
    intervalRef.current = setInterval(() => {
      sec++;
      setElapsed(sec);
      if (sec >= duration) {
        clearTimer();
        onPhaseEventRef.current({ type: "phase-end", phase: proto[idx].phase, stepIndex: idx, timestampMs: currentTsRef.current });
        beginStepRef.current(idx + 1);
      }
    }, 1000);
  }, [clearTimer]);
  beginStepRef.current = beginStep;

  const startProtocol = useCallback(() => {
    if (!canStart) return;
    onStart();
    setState("countdown");
    setStepIndex(0);
    setCountdownLeft(COUNTDOWN_SEC);
    setElapsed(0);

    let count = COUNTDOWN_SEC;
    clearTimer();
    intervalRef.current = setInterval(() => {
      count--;
      setCountdownLeft(count);
      if (count <= 0) {
        clearTimer();
        beginStepRef.current(0);
      }
    }, 1000);
  }, [canStart, onStart, clearTimer]);

  const stopProtocol = useCallback(() => {
    clearTimer();
    if (state === "running" && stepIndex < protocol.length) {
      onPhaseEventRef.current({ type: "phase-end", phase: protocol[stepIndex].phase, stepIndex, timestampMs: currentTsRef.current });
    }
    setState("idle");
    setStepIndex(0);
    setElapsed(0);
    setCountdownLeft(0);
    onStop();
  }, [state, stepIndex, protocol, onStop, clearTimer]);

  const skipStep = useCallback(() => {
    if (state !== "running") return;
    clearTimer();
    onPhaseEventRef.current({ type: "phase-end", phase: protocol[stepIndex].phase, stepIndex, timestampMs: currentTsRef.current });
    beginStepRef.current(stepIndex + 1);
  }, [state, stepIndex, protocol, clearTimer]);

  const handleDurationChange = useCallback((idx: number, value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 1 || num > 60) return;
    setProtocol(prev => prev.map((s, i) => i === idx ? { ...s, durationSec: num } : s));
  }, []);

  const currentStep = stepIndex < protocol.length ? protocol[stepIndex] : null;
  const currentCfg = currentStep ? EMG_PHASE_CONFIG[currentStep.phase] : null;
  const progress = currentStep ? elapsed / currentStep.durationSec : 0;
  const remaining = currentStep ? currentStep.durationSec - elapsed : 0;

  const isActive = state === "countdown" || state === "running";

  return (
    <div className="flex flex-col gap-2">
      {/* Header with config toggle */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-secondary font-medium uppercase tracking-wider">Protocolo</span>
        {state === "idle" && (
          <button
            onClick={() => setShowConfig(v => !v)}
            className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
            title="Configurar protocolo"
          >
            <Settings2 className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Config panel */}
      {showConfig && state === "idle" && (
        <div className="flex flex-col gap-1 p-2 bg-surface-800 rounded border border-surface-600">
          {protocol.map((step, i) => {
            const cfg = EMG_PHASE_CONFIG[step.phase];
            return (
              <div key={i} className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cfg.color }} />
                  <span className="text-[10px]" style={{ color: cfg.color }}>{cfg.label}</span>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={step.durationSec}
                    onChange={e => handleDurationChange(i, e.target.value)}
                    className="w-10 px-1 py-0.5 text-[10px] font-mono bg-surface-900 border border-surface-600 rounded text-primary text-right"
                  />
                  <span className="text-[9px] text-secondary">s</span>
                </div>
              </div>
            );
          })}
          <div className="h-px bg-surface-600 my-1" />
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={autoStop}
              onChange={e => setAutoStop(e.target.checked)}
              className="w-3 h-3 rounded border-surface-600 accent-green-500"
            />
            <span className="text-[10px] text-secondary">Detener grabación al finalizar</span>
          </label>
          <div className="text-[9px] text-secondary mt-1 text-center">
            Total: {protocol.reduce((s, p) => s + p.durationSec, 0)}s + {COUNTDOWN_SEC}s cuenta regresiva
          </div>
        </div>
      )}

      {/* Phase sequence overview */}
      <div className="flex gap-0.5 h-2 rounded overflow-hidden bg-surface-800">
        {protocol.map((step, i) => {
          const cfg = EMG_PHASE_CONFIG[step.phase];
          const totalDur = protocol.reduce((s, p) => s + p.durationSec, 0);
          const widthPct = (step.durationSec / totalDur) * 100;
          const isCurrentStep = isActive && i === stepIndex;
          const isDone = isActive && i < stepIndex;
          return (
            <div
              key={i}
              className="relative transition-opacity duration-300"
              style={{
                width: `${widthPct}%`,
                backgroundColor: isDone ? cfg.color : cfg.bg,
                opacity: isActive && !isCurrentStep && !isDone ? 0.3 : 1,
              }}
            >
              {isCurrentStep && state === "running" && (
                <div
                  className="absolute inset-y-0 left-0 transition-all duration-1000 ease-linear"
                  style={{ width: `${progress * 100}%`, backgroundColor: cfg.color }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Main display area */}
      {state === "idle" && (
        <button
          onClick={startProtocol}
          disabled={!canStart}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-2 text-xs rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 disabled:opacity-30 transition-colors"
        >
          <Play className="h-3.5 w-3.5" />
          Iniciar protocolo
        </button>
      )}

      {state === "countdown" && (
        <div className="flex flex-col items-center gap-1 py-3">
          <span className="text-[10px] text-secondary uppercase tracking-wider">Preparese</span>
          <span className="text-4xl font-bold text-amber-400 font-mono tabular-nums">
            {countdownLeft}
          </span>
          <span className="text-[10px] text-secondary">
            Siguiente: {protocol[0] ? EMG_PHASE_CONFIG[protocol[0].phase].label : ""}
          </span>
          <button
            onClick={stopProtocol}
            className="mt-1 px-3 py-1 text-[10px] rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
          >
            Cancelar
          </button>
        </div>
      )}

      {state === "running" && currentStep && currentCfg && (
        <div className="flex flex-col gap-2">
          {/* Phase indicator */}
          <div
            className="rounded-lg p-3 border transition-colors duration-500"
            style={{
              borderColor: currentCfg.color,
              backgroundColor: currentCfg.bg,
            }}
          >
            {/* Phase name + step counter */}
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold" style={{ color: currentCfg.color }}>
                {currentCfg.label}
              </span>
              <span className="text-[10px] text-secondary">
                {stepIndex + 1}/{protocol.length}
              </span>
            </div>

            {/* Instruction */}
            <p className="text-[11px] text-primary mb-2">
              {currentStep.instruction}
            </p>

            {/* Countdown circle + progress */}
            <div className="flex items-center gap-3">
              {/* Circular countdown */}
              <div className="relative w-12 h-12 flex-shrink-0">
                <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
                  <circle
                    cx="24" cy="24" r="20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    className="text-surface-700"
                  />
                  <circle
                    cx="24" cy="24" r="20"
                    fill="none"
                    stroke={currentCfg.color}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 20}`}
                    strokeDashoffset={`${2 * Math.PI * 20 * (1 - progress)}`}
                    className="transition-all duration-1000 ease-linear"
                  />
                </svg>
                <span
                  className="absolute inset-0 flex items-center justify-center text-sm font-bold font-mono tabular-nums"
                  style={{ color: currentCfg.color }}
                >
                  {remaining}
                </span>
              </div>

              {/* Progress bar */}
              <div className="flex-1">
                <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-1000 ease-linear"
                    style={{
                      width: `${progress * 100}%`,
                      backgroundColor: currentCfg.color,
                    }}
                  />
                </div>
                <div className="flex justify-between mt-0.5">
                  <span className="text-[9px] text-secondary">{elapsed}s</span>
                  <span className="text-[9px] text-secondary">{currentStep.durationSec}s</span>
                </div>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex gap-1.5">
            <button
              onClick={stopProtocol}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
            >
              <Square className="h-3 w-3" />
              Detener
            </button>
            <button
              onClick={skipStep}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] rounded bg-surface-700 text-secondary hover:text-primary transition-colors"
            >
              <SkipForward className="h-3 w-3" />
              Saltar
            </button>
          </div>

          {/* Next up */}
          {stepIndex + 1 < protocol.length && (
            <div className="text-[9px] text-secondary text-center">
              Siguiente: {EMG_PHASE_CONFIG[protocol[stepIndex + 1].phase].label} ({protocol[stepIndex + 1].durationSec}s)
            </div>
          )}
        </div>
      )}

      {state === "finished" && (
        <div className="flex flex-col items-center gap-2 py-2">
          <span className="text-xs text-green-400 font-medium">Protocolo completado</span>
          <span className="text-[10px] text-secondary">
            {protocol.length} fases registradas automaticamente
          </span>
          <button
            onClick={() => { setState("idle"); setStepIndex(0); setElapsed(0); }}
            className="px-3 py-1 text-[10px] rounded bg-surface-700 text-secondary hover:text-primary transition-colors"
          >
            Reiniciar
          </button>
        </div>
      )}
    </div>
  );
}
