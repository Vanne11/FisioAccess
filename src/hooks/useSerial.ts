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
  value: number;
}

export function useSerial(defaultBaudRate = 115200, bufferSize = 500) {
  const [ports, setPorts] = useState<string[]>([]);
  const [selectedPort, setSelectedPort] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DataPoint[]>([]);
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  const startListening = useCallback(async () => {
    const u1 = await listen<DataPoint>("serial-data", (event) => {
      setData((prev) => {
        const next = [...prev, event.payload];
        return next.length > bufferSize ? next.slice(-bufferSize) : next;
      });
    });

    const u2 = await listen<string>("serial-error", (event) => {
      setError(event.payload);
    });

    const u3 = await listen("serial-disconnected", () => {
      setIsConnected(false);
    });

    unlistenRefs.current = [u1, u2, u3];
  }, [bufferSize]);

  const stopListening = useCallback(() => {
    unlistenRefs.current.forEach((fn) => fn());
    unlistenRefs.current = [];
  }, []);

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

  const connect = useCallback(async () => {
    setError(null);
    setData([]);
    if (!selectedPort) {
      setError("No hay puerto seleccionado");
      return;
    }
    try {
      await startListening();
      const result = await invoke<ConnectionStatus>("serial_connect", {
        port: selectedPort,
        baudRate: defaultBaudRate,
      });
      setIsConnected(result.connected);
    } catch (e) {
      stopListening();
      setError(String(e));
    }
  }, [selectedPort, defaultBaudRate, startListening, stopListening]);

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      await invoke<ConnectionStatus>("serial_disconnect");
      setIsConnected(false);
    } catch (e) {
      setError(String(e));
    }
    stopListening();
  }, [stopListening]);

  const clearData = useCallback(() => {
    setData([]);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopListening();
  }, [stopListening]);

  return {
    ports,
    selectedPort,
    setSelectedPort,
    isConnected,
    error,
    data,
    refreshPorts,
    connect,
    disconnect,
    clearData,
  };
}
