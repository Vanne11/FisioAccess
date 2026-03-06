import { cn } from "@/lib/utils";

type Status = "connected" | "disconnected" | "calibrated" | "testing";

const config: Record<Status, { dot: string; text: string; label: string }> = {
  connected: {
    dot: "bg-emerald-400",
    text: "text-emerald-400",
    label: "Conectado",
  },
  disconnected: {
    dot: "bg-slate-500",
    text: "text-slate-500",
    label: "Desconectado",
  },
  calibrated: {
    dot: "bg-blue-400",
    text: "text-blue-400",
    label: "Calibrado",
  },
  testing: {
    dot: "bg-amber-400",
    text: "text-amber-400",
    label: "Probando...",
  },
};

interface StatusBadgeProps {
  status: Status;
  label?: string;
  className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const c = config[status];
  return (
    <div className={cn("flex items-center gap-2 text-sm", className)}>
      <span
        className={cn("h-2 w-2 rounded-full", c.dot, {
          "animate-dot-blink": status === "connected" || status === "testing",
        })}
      />
      <span className={c.text}>{label ?? c.label}</span>
    </div>
  );
}
