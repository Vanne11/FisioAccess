import { Link, useLocation } from "react-router-dom";
import {
  BicepsFlexed,
  Heart,
  Wind,
  LayoutDashboard,
  Settings,
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
  { to: "/emg", icon: BicepsFlexed, label: "EMG", color: "text-emg-400" },
  { to: "/spiro", icon: Wind, label: "Espiro", color: "text-spiro-400" },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <nav className="w-16 lg:w-56 flex flex-col border-r border-border bg-surface-900/80 backdrop-blur-sm">
      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b border-border">
        <span className="hidden lg:block text-sm font-semibold text-primary tracking-wide">
          FisioAccess
        </span>
        <span className="lg:hidden text-sm font-bold text-primary">FA</span>
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
                    ? "bg-surface-800 text-primary"
                    : "text-secondary hover:bg-surface-800 hover:text-primary",
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

      {/* Settings + Footer */}
      <div className="p-2 border-t border-border">
        <Link
          to="/settings"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
            location.pathname === "/settings"
              ? "bg-surface-800 text-primary"
              : "text-secondary hover:bg-surface-800 hover:text-primary",
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          <span className="hidden lg:block">Configuracion</span>
        </Link>
        <span className="hidden lg:block text-[10px] text-muted px-3 mt-2">
          v0.1.0
        </span>
      </div>
    </nav>
  );
}
