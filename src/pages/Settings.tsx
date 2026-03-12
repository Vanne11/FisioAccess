import {
  Settings as SettingsIcon,
  Check,
  FolderOpen,
  Building2,
  UserRound,
  ImagePlus,
  X,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { PageHeader } from "@/components/layout/PageHeader";
import { useThemeStore, type Theme } from "@/stores/useThemeStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { useReportStore } from "@/stores/useReportStore";
import { cn } from "@/lib/utils";

const themes: {
  id: Theme;
  name: string;
  description: string;
  preview: { bg: string; surface: string; accent: string; text: string };
}[] = [
  {
    id: "dark",
    name: "Oscuro",
    description: "Tema oscuro por defecto",
    preview: {
      bg: "#020617",
      surface: "#1e293b",
      accent: "#334155",
      text: "#f1f5f9",
    },
  },
  {
    id: "light",
    name: "Claro",
    description: "Tema claro para ambientes iluminados",
    preview: {
      bg: "#ffffff",
      surface: "#f1f5f9",
      accent: "#e2e8f0",
      text: "#0f172a",
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    description: "Tema oscuro con acentos purpura",
    preview: {
      bg: "#282a36",
      surface: "#343746",
      accent: "#44475a",
      text: "#f8f8f2",
    },
  },
  {
    id: "alucard",
    name: "Alucard",
    description: "Variante clara inspirada en Dracula",
    preview: {
      bg: "#f8f8f2",
      surface: "#e8e8e0",
      accent: "#d0d0c8",
      text: "#282a36",
    },
  },
];

function InputField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-secondary mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-border bg-surface-800/50 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-ecg-500/50 transition-colors"
      />
    </div>
  );
}

export function Settings() {
  const { theme, setTheme } = useThemeStore();
  const { workDir, setWorkDir } = useWorkspaceStore();
  const { config, updateConfig } = useReportStore();

  const handleSelectFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Seleccionar carpeta de trabajo",
    });
    if (selected) {
      setWorkDir(selected);
    }
  };

  const handleSelectLogo = async () => {
    const selected = await open({
      multiple: false,
      title: "Seleccionar logo",
      filters: [
        { name: "Imagenes", extensions: ["png", "jpg", "jpeg", "webp"] },
      ],
    });
    if (selected) {
      const bytes = await readFile(selected);
      const ext = selected.split(".").pop()?.toLowerCase() || "png";
      const mime =
        ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
      const base64 = btoa(
        bytes.reduce((data, byte) => data + String.fromCharCode(byte), ""),
      );
      updateConfig({ clinicLogo: `data:${mime};base64,${base64}` });
    }
  };

  return (
    <div className="overflow-y-auto flex-1 pr-2">
      <PageHeader
        title="Configuracion"
        icon={<SettingsIcon className="h-5 w-5" />}
      />

      {/* Carpeta de trabajo */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-primary mb-1">
          Carpeta de trabajo
        </h2>
        <p className="text-sm text-secondary mb-4">
          Carpeta donde se guardaran los archivos exportados
        </p>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSelectFolder}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:border-border-hover bg-surface-800/50 transition-all duration-200"
          >
            <FolderOpen className="h-4 w-4 text-secondary" />
            <span className="text-sm text-primary">Seleccionar carpeta</span>
          </button>

          {workDir && (
            <div className="flex-1 min-w-0 px-4 py-2.5 rounded-xl border border-border bg-surface-800/30">
              <p className="text-xs text-secondary mb-0.5">Ruta actual</p>
              <p className="text-sm text-primary font-mono truncate">
                {workDir}
              </p>
            </div>
          )}

          {!workDir && (
            <p className="text-sm text-muted italic">
              No se ha seleccionado ninguna carpeta
            </p>
          )}
        </div>
      </section>

      {/* Datos del informe */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-primary mb-1">
          Datos del informe
        </h2>
        <p className="text-sm text-secondary mb-4">
          Informacion base que aparecera en todos los informes generados
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Centro / Clínica */}
          <div className="rounded-xl border border-border p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="h-4 w-4 text-ecg-400" />
              <h3 className="text-sm font-medium text-primary">
                Centro / Clinica
              </h3>
            </div>

            {/* Logo */}
            <div>
              <label className="block text-xs text-secondary mb-1.5">
                Logo
              </label>
              <div className="flex items-center gap-3">
                {config.clinicLogo ? (
                  <div className="relative group">
                    <img
                      src={config.clinicLogo}
                      alt="Logo"
                      className="h-16 w-16 rounded-lg object-contain border border-border bg-surface-800/50"
                    />
                    <button
                      onClick={() => updateConfig({ clinicLogo: "" })}
                      className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleSelectLogo}
                    className="h-16 w-16 rounded-lg border border-dashed border-border hover:border-border-hover bg-surface-800/30 flex items-center justify-center transition-colors"
                  >
                    <ImagePlus className="h-5 w-5 text-muted" />
                  </button>
                )}
                {config.clinicLogo && (
                  <button
                    onClick={handleSelectLogo}
                    className="text-xs text-secondary hover:text-primary transition-colors"
                  >
                    Cambiar
                  </button>
                )}
              </div>
            </div>

            <InputField
              label="Nombre del centro"
              value={config.clinicName}
              onChange={(v) => updateConfig({ clinicName: v })}
              placeholder="Ej: Centro de Fisioterapia..."
            />
            <InputField
              label="Direccion"
              value={config.clinicAddress}
              onChange={(v) => updateConfig({ clinicAddress: v })}
              placeholder="Ej: Calle Mayor 1, Madrid"
            />
            <InputField
              label="Telefono"
              value={config.clinicPhone}
              onChange={(v) => updateConfig({ clinicPhone: v })}
              placeholder="Ej: +34 600 000 000"
              type="tel"
            />
            <InputField
              label="Correo electronico"
              value={config.clinicEmail}
              onChange={(v) => updateConfig({ clinicEmail: v })}
              placeholder="Ej: contacto@clinica.com"
              type="email"
            />
          </div>

          {/* Profesional */}
          <div className="rounded-xl border border-border p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <UserRound className="h-4 w-4 text-emg-400" />
              <h3 className="text-sm font-medium text-primary">Profesional</h3>
            </div>

            <InputField
              label="Nombre completo"
              value={config.professionalName}
              onChange={(v) => updateConfig({ professionalName: v })}
              placeholder="Ej: Dr. Juan Garcia"
            />
            <InputField
              label="Titulo / Especialidad"
              value={config.professionalTitle}
              onChange={(v) => updateConfig({ professionalTitle: v })}
              placeholder="Ej: Fisioterapeuta"
            />
            <InputField
              label="Numero de colegiado"
              value={config.professionalLicense}
              onChange={(v) => updateConfig({ professionalLicense: v })}
              placeholder="Ej: 12345"
            />
          </div>
        </div>
      </section>

      {/* Apariencia */}
      <section>
        <h2 className="text-sm font-semibold text-primary mb-1">Apariencia</h2>
        <p className="text-sm text-secondary mb-4">
          Selecciona el tema de la interfaz
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {themes.map((t) => {
            const active = theme === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={cn(
                  "relative rounded-xl border p-4 text-left transition-all duration-200",
                  active
                    ? "border-ecg-500 ring-1 ring-ecg-500/30"
                    : "border-border hover:border-border-hover",
                )}
              >
                {/* Preview */}
                <div
                  className="rounded-lg overflow-hidden mb-3 h-20 p-2 flex flex-col gap-1.5"
                  style={{ backgroundColor: t.preview.bg }}
                >
                  <div
                    className="h-2.5 w-3/4 rounded"
                    style={{ backgroundColor: t.preview.surface }}
                  />
                  <div
                    className="h-2.5 w-1/2 rounded"
                    style={{ backgroundColor: t.preview.accent }}
                  />
                  <div className="flex gap-1 mt-auto">
                    <div
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: "#10b981" }}
                    />
                    <div
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: "#f43f5e" }}
                    />
                    <div
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: "#8b5cf6" }}
                    />
                  </div>
                </div>

                {/* Label */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-primary">
                      {t.name}
                    </p>
                    <p className="text-xs text-secondary">{t.description}</p>
                  </div>
                  {active && (
                    <Check className="h-4 w-4 text-ecg-400 shrink-0" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
