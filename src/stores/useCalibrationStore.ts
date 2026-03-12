import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ADCResolution, CalibrationConfig } from "@/utils/signalCalibrator";
import { DEFAULT_CALIBRATION } from "@/utils/signalCalibrator";

interface CalibrationStore extends CalibrationConfig {
  isCalibrated: boolean;
  autoDetected: boolean;
  setADCBits: (bits: ADCResolution) => void;
  setVRef: (v: number) => void;
  setHWGain: (g: number) => void;
  setCalibrationFactor: (f: number) => void;
  setCalibrated: (v: boolean) => void;
  setAutoDetected: (v: boolean) => void;
  applyConfig: (c: Partial<CalibrationConfig>) => void;
  reset: () => void;
}

export const useCalibrationStore = create<CalibrationStore>()(
  persist(
    (set) => ({
      ...DEFAULT_CALIBRATION,
      isCalibrated: false,
      autoDetected: false,

      setADCBits: (adcBits) => set({ adcBits }),
      setVRef: (vRef) => set({ vRef }),
      setHWGain: (hwGain) => set({ hwGain }),
      setCalibrationFactor: (calibrationFactor) =>
        set({ calibrationFactor, isCalibrated: true }),
      setCalibrated: (isCalibrated) => set({ isCalibrated }),
      setAutoDetected: (autoDetected) => set({ autoDetected }),
      applyConfig: (c) => set(c),
      reset: () =>
        set({
          ...DEFAULT_CALIBRATION,
          isCalibrated: false,
          autoDetected: false,
        }),
    }),
    {
      name: "fisioaccess-calibration",
      version: 2,
      migrate: () => ({
        ...DEFAULT_CALIBRATION,
        isCalibrated: false,
        autoDetected: false,
      }),
    },
  ),
);

/** Selector para obtener CalibrationConfig plana */
export function selectCalibrationConfig(s: CalibrationStore): CalibrationConfig {
  return {
    adcBits: s.adcBits,
    vRef: s.vRef,
    hwGain: s.hwGain,
    calibrationFactor: s.calibrationFactor,
  };
}
