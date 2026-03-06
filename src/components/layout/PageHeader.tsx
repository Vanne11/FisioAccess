import { type ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, icon, actions }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        {icon && <span className="text-slate-400">{icon}</span>}
        <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
