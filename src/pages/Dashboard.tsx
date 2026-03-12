import { Link } from "react-router-dom";
import { Heart, Activity, Wind, LayoutDashboard } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { cn } from "@/lib/utils";

const modules = [
  {
    to: "/ecg",
    icon: Heart,
    title: "Monitor ECG",
    description: "Electrocardiograma - Monitoreo de actividad cardiaca",
    color: "text-ecg-400",
    border: "hover:border-ecg-500/30",
    bg: "hover:bg-ecg-500/5",
  },
  {
    to: "/emg",
    icon: Activity,
    title: "Monitor EMG",
    description: "Electromiograma - Monitoreo de actividad muscular",
    color: "text-emg-400",
    border: "hover:border-emg-500/30",
    bg: "hover:bg-emg-500/5",
  },
  {
    to: "/spiro",
    icon: Wind,
    title: "Espirometro",
    description: "Pruebas de funcion pulmonar",
    color: "text-spiro-400",
    border: "hover:border-spiro-500/30",
    bg: "hover:bg-spiro-500/5",
  },
];

export function Dashboard() {
  return (
    <div>
      <PageHeader
        title="FisioAccess"
        icon={<LayoutDashboard className="h-5 w-5" />}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {modules.map(({ to, icon: Icon, title, description, color, border, bg }) => (
          <Link key={to} to={to} className="group">
            <div
              className={cn(
                "rounded-xl border border-border bg-surface-800/50 p-6 transition-all duration-200",
                border,
                bg,
              )}
            >
              <Icon className={cn("h-10 w-10 mb-4", color)} />
              <h2 className="text-base font-semibold text-primary mb-1">
                {title}
              </h2>
              <p className="text-sm text-secondary">{description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
