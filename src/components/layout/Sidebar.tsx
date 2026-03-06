import { Link, useLocation } from "react-router-dom";
import {
  Activity,
  Heart,
  Wind,
  LayoutDashboard,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  color?: string;
}

const navItems: NavItem[] = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/ecg", icon: Heart, label: "ECG", color: "text-ecg-400" },
  { to: "/emg", icon: Activity, label: "EMG", color: "text-emg-400" },
  { to: "/spiro", icon: Wind, label: "Espiro", color: "text-spiro-400" },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <nav className="w-16 lg:w-56 flex flex-col border-r border-white/5 bg-surface-900/80 backdrop-blur-sm">
      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b border-white/5">
        <span className="hidden lg:block text-sm font-semibold text-slate-200 tracking-wide">
          FisioAcces
        </span>
        <span className="lg:hidden text-sm font-bold text-slate-200">FA</span>
      </div>

      {/* Nav */}
      <ul className="flex-1 p-2 space-y-1">
        {navItems.map(({ to, icon: Icon, label, color }) => {
          const active = location.pathname === to;
          return (
            <li key={to}>
              <Link
                to={to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                  active
                    ? "bg-white/5 text-slate-100"
                    : "text-slate-500 hover:bg-white/5 hover:text-slate-300",
                )}
              >
                <Icon
                  className={cn("h-4 w-4 shrink-0", active && color)}
                />
                <span className="hidden lg:block">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Footer */}
      <div className="p-3 border-t border-white/5">
        <span className="hidden lg:block text-[10px] text-slate-600">
          v0.1.0
        </span>
      </div>
    </nav>
  );
}
