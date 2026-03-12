import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";
import { Dashboard } from "@/pages/Dashboard";
import { ECGMonitor } from "@/pages/ECGMonitor";
import { EMGMonitor } from "@/pages/EMGMonitor";
import { SpiroMonitor } from "@/pages/SpiroMonitor";
import { Settings } from "@/pages/Settings";
import { useThemeStore } from "@/stores/useThemeStore";

function App() {
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <BrowserRouter>
      <div className="flex h-screen bg-surface-950">
        <Sidebar />
        <main className="flex-1 min-w-0 min-h-0 overflow-hidden p-6 flex flex-col">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/ecg" element={<ECGMonitor />} />
            <Route path="/emg" element={<EMGMonitor />} />
            <Route path="/spiro" element={<SpiroMonitor />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
