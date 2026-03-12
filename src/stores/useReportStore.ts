import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ReportConfig {
  // Centro / Clínica
  clinicName: string;
  clinicAddress: string;
  clinicPhone: string;
  clinicEmail: string;
  clinicLogo: string; // base64 o ruta

  // Profesional
  professionalName: string;
  professionalTitle: string;
  professionalLicense: string;
}

interface ReportStore {
  config: ReportConfig;
  updateConfig: (partial: Partial<ReportConfig>) => void;
}

const defaultConfig: ReportConfig = {
  clinicName: "",
  clinicAddress: "",
  clinicPhone: "",
  clinicEmail: "",
  clinicLogo: "",
  professionalName: "",
  professionalTitle: "",
  professionalLicense: "",
};

export const useReportStore = create<ReportStore>()(
  persist(
    (set) => ({
      config: defaultConfig,
      updateConfig: (partial) =>
        set((s) => ({ config: { ...s.config, ...partial } })),
    }),
    { name: "fisioaccess-report" },
  ),
);
