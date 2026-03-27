import { type ReactNode, createContext, useContext, useState } from "react";
import { type Lang, translations } from "./i18n";

interface LangContextType {
  lang: Lang;
  t: (typeof translations)["en"];
  toggleLang: () => void;
}

const LangContext = createContext<LangContextType | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const stored = (localStorage.getItem("interview_lang") as Lang) || "en";
  const [lang, setLang] = useState<Lang>(stored);

  const toggleLang = () => {
    const next: Lang = lang === "en" ? "hi" : "en";
    setLang(next);
    localStorage.setItem("interview_lang", next);
  };

  return (
    <LangContext.Provider value={{ lang, t: translations[lang], toggleLang }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be inside LanguageProvider");
  return ctx;
}
