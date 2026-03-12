import { Settings as SettingsIcon, Check, FolderOpen } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { useThemeStore, type Theme } from "@/stores/useThemeStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
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

export function Settings() {
  const { theme, setTheme } = useThemeStore();
  const { workDir, setWorkDir } = useWorkspaceStore();

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

  return (
    <div>
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
