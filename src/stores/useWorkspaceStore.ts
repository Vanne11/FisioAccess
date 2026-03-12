import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WorkspaceStore {
  workDir: string;
  setWorkDir: (path: string) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set) => ({
      workDir: "",
      setWorkDir: (path) => set({ workDir: path }),
    }),
    { name: "fisioaccess-workspace" },
  ),
);
