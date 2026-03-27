import { type ReactNode, createContext, useContext, useState } from "react";
import type { Question } from "./api";

export type Screen = "otp" | "intro" | "interview" | "upload";

export interface AppState {
  screen: Screen;
  interviewId: string;
  token: string;
  candidateName: string;
  candidateEmail: string;
  department: string;
  designation: string;
  questions: Question[];
  maxSwitch: number;
  currentQuestionIndex: number;
  screenSwitchCount: number;
  recordedBlob: Blob | null;
  selectedQuestionUIDs: string[];
}

interface AppContextType {
  state: AppState;
  setState: (patch: Partial<AppState>) => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const params = new URLSearchParams(window.location.search);
  const interviewId = params.get("id") ?? "";

  const [state, setStateFull] = useState<AppState>({
    screen: "otp",
    interviewId,
    token: "",
    candidateName: "",
    candidateEmail: "",
    department: "",
    designation: "",
    questions: [],
    maxSwitch: 10,
    currentQuestionIndex: 0,
    screenSwitchCount: 0,
    recordedBlob: null,
    selectedQuestionUIDs: [],
  });

  const setState = (patch: Partial<AppState>) =>
    setStateFull((prev) => ({ ...prev, ...patch }));

  return (
    <AppContext.Provider value={{ state, setState }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be inside AppProvider");
  return ctx;
}
