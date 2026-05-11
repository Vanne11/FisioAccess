import { useEffect, useState, useMemo } from "react";
import { X, Save as SaveIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  type SpiroPatient,
  type SpiroAnalysis,
  type Sex,
  type Ethnicity,
  ETHNICITIES,
  emptyPatient,
  emptyAnalysis,
  computeAgeFromBirth,
  validateStudy,
} from "@/lib/spiro/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (patient: SpiroPatient, analysis: SpiroAnalysis) => Promise<void> | void;
  initialPatient?: SpiroPatient;
  initialAnalysis?: SpiroAnalysis;
  recordingsCount: number;
}

const SEXES: Sex[] = ["Masculino", "Femenino", "Otro"];

function Field({
  label,
  children,
  error,
  span = 1,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
  span?: 1 | 2 | 3;
}) {
  const colSpan = span === 1 ? "" : span === 2 ? "col-span-2" : "col-span-3";
  return (
    <div className={colSpan}>
      <label className="block text-[11px] text-secondary mb-1">{label}</label>
      {children}
      {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}
    </div>
  );
}

const inputCls =
  "w-full px-2.5 py-1.5 rounded-lg border border-border bg-surface-800/60 text-xs text-primary placeholder:text-muted focus:outline-none focus:border-spiro-400/60 transition-colors";

export function SpiroSaveDialog({
  open,
  onClose,
  onSave,
  initialPatient,
  initialAnalysis,
  recordingsCount,
}: Props) {
  const [patient, setPatient] = useState<SpiroPatient>(initialPatient ?? emptyPatient());
  const [analysis, setAnalysis] = useState<SpiroAnalysis>(initialAnalysis ?? emptyAnalysis());
  const [saving, setSaving] = useState(false);
  const [globalError, setGlobalError] = useState("");

  useEffect(() => {
    if (open) {
      setPatient(initialPatient ?? emptyPatient());
      setAnalysis(initialAnalysis ?? emptyAnalysis());
      setGlobalError("");
    }
  }, [open, initialPatient, initialAnalysis]);

  useEffect(() => {
    const age = computeAgeFromBirth(patient.fechaNacimiento);
    if (age !== null && age !== patient.edad) {
      setPatient((p) => ({ ...p, edad: age }));
    }
  }, [patient.fechaNacimiento]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = useMemo(() => validateStudy(patient, analysis), [patient, analysis]);
  const errorByField = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of errors) m[e.field] = e.message;
    return m;
  }, [errors]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (errors.length > 0) {
      setGlobalError("Revise los campos obligatorios");
      return;
    }
    setGlobalError("");
    setSaving(true);
    try {
      await onSave(patient, analysis);
      onClose();
    } catch (e) {
      setGlobalError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col bg-surface-900 rounded-2xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <SaveIcon className="h-4 w-4 text-spiro-400" />
            <span className="text-sm font-medium text-primary">
              Guardar estudio espirométrico
            </span>
            <span className="text-xs text-secondary">
              ({recordingsCount} {recordingsCount === 1 ? "maniobra" : "maniobras"})
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-secondary mb-2">
              Datos del paciente
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Nombre *" span={2} error={errorByField.nombre}>
                <input
                  className={inputCls}
                  value={patient.nombre}
                  onChange={(e) => setPatient({ ...patient, nombre: e.target.value })}
                  placeholder="Nombre completo"
                />
              </Field>
              <Field label="RUT / Identificación *" error={errorByField.rut}>
                <input
                  className={inputCls}
                  value={patient.rut}
                  onChange={(e) => setPatient({ ...patient, rut: e.target.value })}
                  placeholder="12.345.678-9"
                />
              </Field>
              <Field label="Sexo">
                <select
                  className={inputCls}
                  value={patient.sexo}
                  onChange={(e) => setPatient({ ...patient, sexo: e.target.value as Sex })}
                >
                  {SEXES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Fecha de nacimiento">
                <input
                  type="date"
                  className={inputCls}
                  value={patient.fechaNacimiento}
                  onChange={(e) => setPatient({ ...patient, fechaNacimiento: e.target.value })}
                />
              </Field>
              <Field label="Edad (años)">
                <input
                  type="number"
                  min={0}
                  max={150}
                  className={inputCls}
                  value={patient.edad}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    setPatient({ ...patient, edad: Number.isFinite(n) ? n : 0 });
                  }}
                />
              </Field>
              <Field label="Etnia">
                <select
                  className={inputCls}
                  value={patient.etnia}
                  onChange={(e) => setPatient({ ...patient, etnia: e.target.value as Ethnicity })}
                >
                  {ETHNICITIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Estatura (cm) *" error={errorByField.estaturaCm}>
                <input
                  type="number"
                  min={50}
                  max={250}
                  className={inputCls}
                  value={patient.estaturaCm}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    setPatient({ ...patient, estaturaCm: Number.isFinite(n) ? n : 0 });
                  }}
                />
              </Field>
              <Field label="Peso (kg) *" error={errorByField.pesoKg}>
                <input
                  type="number"
                  min={10}
                  max={300}
                  step={0.1}
                  className={inputCls}
                  value={patient.pesoKg}
                  onChange={(e) => {
                    const n = parseFloat(e.target.value);
                    setPatient({ ...patient, pesoKg: Number.isFinite(n) ? n : 0 });
                  }}
                />
              </Field>
              <Field label="Comentarios" span={3}>
                <textarea
                  className={inputCls}
                  rows={2}
                  value={patient.comentarios}
                  onChange={(e) => setPatient({ ...patient, comentarios: e.target.value })}
                  placeholder="Observaciones libres del paciente"
                />
              </Field>
            </div>
          </section>

          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-secondary mb-2">
              Análisis clínico
            </h3>
            <div className="grid grid-cols-1 gap-3">
              <Field label="Interpretación *" error={errorByField.interpretacion}>
                <textarea
                  className={inputCls}
                  rows={3}
                  value={analysis.interpretacion}
                  onChange={(e) => setAnalysis({ ...analysis, interpretacion: e.target.value })}
                  placeholder="Patrón obstructivo / restrictivo / mixto / normal..."
                />
              </Field>
              <Field label="Conclusión *" error={errorByField.conclusion}>
                <textarea
                  className={inputCls}
                  rows={3}
                  value={analysis.conclusion}
                  onChange={(e) => setAnalysis({ ...analysis, conclusion: e.target.value })}
                  placeholder="Conclusión diagnóstica"
                />
              </Field>
            </div>
          </section>

          {globalError && (
            <p className="text-xs text-red-400">{globalError}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={saving || errors.length > 0 || recordingsCount === 0}
          >
            <SaveIcon className="h-4 w-4 mr-1" />
            {saving ? "Guardando..." : "Guardar estudio"}
          </Button>
        </div>
      </div>
    </div>
  );
}
