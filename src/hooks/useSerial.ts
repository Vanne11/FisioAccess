import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface PortInfo {
  name: string;
  port_type: string;
}

interface ConnectionStatus {
  connected: boolean;
  port: string | null;
}

export interface DataPoint {
  timestamp_ms: number;
  /** Señal filtrada (forma de onda, puede ser negativa) — usado por EMG */
  filtered: number;
  /** Envolvente suavizada (>= 0, amplitud de contracción) — usado por EMG */
  envelope: number;
  /** Alias: señal principal para módulos que no usan dual (ECG, Spiro) */
  value: number;
}

/** Intervalo de flush al state (ms). 20Hz es suficiente para UI fluida. */
const FLUSH_INTERVAL = 50;

export function useSerial(defaultBaudRate = 115200, bufferSize = 500, mode?: string) {
  const [ports, setPorts] = useState<string[]>([]);
  const [selectedPort, setSelectedPort] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DataPoint[]>([]);
  const [firmwareBpm, setFirmwareBpm] = useState<number>(0);
  const unlistenRefs = useRef<UnlistenFn[]>([]);
  const recordingRef = useRef(false);

  // --- Batching: acumular muestras en ref, flush periodico al state ---
  const pendingRef = useRef<DataPoint[]>([]);
  const bufferRef = useRef<DataPoint[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startFlush = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setInterval(() => {
      const batch = pendingRef.current;
      if (batch.length === 0) return;
      pendingRef.current = [];

      // Push al buffer interno y truncar si excede
      const buf = bufferRef.current;
      for (let i = 0; i < batch.length; i++) buf.push(batch[i]);
      if (buf.length > bufferSize) {
        bufferRef.current = buf.slice(buf.length - bufferSize);
      }

      // Publicar snapshot inmutable al state (1 copia cada 50ms, no 200/seg)
      setData(bufferRef.current.slice());
    }, FLUSH_INTERVAL);
  }, [bufferSize]);

  const stopFlush = useCallback(() => {
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const startListening = useCallback(async () => {
    const u1 = await listen<{ timestamp_ms: number; filtered: number; envelope: number }>("serial-data", (event) => {
      if (!recordingRef.current) return;
      const p = event.payload;
      pendingRef.current.push({
        timestamp_ms: p.timestamp_ms,
        filtered: p.filtered,
        envelope: p.envelope,
        value: p.filtered,  // alias para ECG/Spiro compatibilidad
      });
    });

    const u2 = await listen<string>("serial-error", (event) => {
      setError(event.payload);
    });

    const u3 = await listen("serial-disconnected", () => {
      setIsConnected(false);
      recordingRef.current = false;
      setRecording(false);
      stopFlush();
    });

    const u4 = await listen<number>("serial-bpm", (event) => {
      if (!recordingRef.current) return;
      setFirmwareBpm(event.payload);
    });

    unlistenRefs.current = [u1, u2, u3, u4];
  }, [stopFlush]);

  const stopListening = useCallback(() => {
    unlistenRefs.current.forEach((fn) => fn());
    unlistenRefs.current = [];
    stopFlush();
  }, [stopFlush]);

  const refreshPorts = useCallback(async () => {
    setError(null);
    try {
      const result = await invoke<PortInfo[]>("list_ports");
      const names = result.map((p) => p.name);
      setPorts(names);
      if (names.length > 0 && !selectedPort) {
        setSelectedPort(names[0]);
      }
    } catch (e) {
      setError(String(e));
      setPorts([]);
    }
  }, [selectedPort]);

  // Solo abre el puerto, no empieza a grabar
  const connect = useCallback(async () => {
    setError(null);
    if (!selectedPort) {
      setError("No hay puerto seleccionado");
      return;
    }
    try {
      await startListening();
      const result = await invoke<ConnectionStatus>("serial_connect", {
        port: selectedPort,
        baudRate: defaultBaudRate,
        mode: mode ?? null,
      });
      setIsConnected(result.connected);
    } catch (e) {
      stopListening();
      setError(String(e));
    }
  }, [selectedPort, defaultBaudRate, startListening, stopListening]);

  // Cierra el puerto
  const disconnect = useCallback(async () => {
    setError(null);
    recordingRef.current = false;
    setRecording(false);
    stopFlush();
    try {
      await invoke<ConnectionStatus>("serial_disconnect");
      setIsConnected(false);
    } catch (e) {
      setError(String(e));
    }
    stopListening();
  }, [stopListening, stopFlush]);

  // Empieza a acumular datos en el buffer
  const startRecording = useCallback(() => {
    recordingRef.current = true;
    setRecording(true);
    startFlush();
  }, [startFlush]);

  // Deja de acumular datos (el puerto sigue abierto)
  const stopRecording = useCallback(() => {
    recordingRef.current = false;
    setRecording(false);
    stopFlush();
    // Flush final de lo que quede pendiente
    if (pendingRef.current.length > 0) {
      const buf = bufferRef.current;
      for (const p of pendingRef.current) buf.push(p);
      pendingRef.current = [];
      if (buf.length > bufferSize) {
        bufferRef.current = buf.slice(buf.length - bufferSize);
      }
      setData(bufferRef.current.slice());
    }
  }, [stopFlush, bufferSize]);

  const clearData = useCallback(() => {
    pendingRef.current = [];
    bufferRef.current = [];
    setData([]);
  }, []);

  // Auto-scan ports on mount
  useEffect(() => {
    refreshPorts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
      stopFlush();
    };
  }, [stopListening, stopFlush]);

  return {
    ports,
    selectedPort,
    setSelectedPort,
    isConnected,
    recording,
    error,
    data,
    firmwareBpm,
    refreshPorts,
    connect,
    disconnect,
    startRecording,
    stopRecording,
    clearData,
  };
}
