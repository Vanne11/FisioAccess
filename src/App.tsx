import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";
import { Dashboard } from "@/pages/Dashboard";
import { ECGMonitor } from "@/pages/ECGMonitor";
import { EMGMonitor } from "@/pages/EMGMonitor";
import { SpiroMonitor } from "@/pages/SpiroMonitor";

function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen bg-surface-950">
        <Sidebar />
        <main className="flex-1 overflow-auto p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/ecg" element={<ECGMonitor />} />
            <Route path="/emg" element={<EMGMonitor />} />
            <Route path="/spiro" element={<SpiroMonitor />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
