import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { BrainCircuit, Briefcase, Building2, Mic, User } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "../AppContext";
import { useLang } from "../LanguageContext";

export default function IntroScreen() {
  const { state, setState } = useApp();
  const { t, lang, toggleLang } = useLang();
  const [agreed, setAgreed] = useState(false);
  const [requestingMic, setRequestingMic] = useState(false);

  const handleStart = async () => {
    if (!agreed) return;
    setRequestingMic(true);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setState({ screen: "interview" });
    } catch {
      toast.error(t.micPermissionError);
    } finally {
      setRequestingMic(false);
    }
  };

  return (
    <div className="min-h-screen bg-background glow-bg flex flex-col overflow-x-hidden">
      {/* Header */}
      <header className="flex items-center px-4 sm:px-6 py-3 sm:py-4 border-b border-border bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-brand-blue flex items-center justify-center flex-shrink-0">
            <BrainCircuit className="w-5 h-5 text-white" />
          </div>
          <span className="text-base sm:text-lg font-semibold gradient-brand truncate">
            {t.brandName}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <Badge className="bg-status-amber/15 text-status-amber border-status-amber/30 text-xs">
            {state.questions.length} {t.questionsLabel}
          </Badge>
          <button
            type="button"
            onClick={toggleLang}
            className="text-xs font-semibold px-2.5 sm:px-3 py-1.5 rounded-full bg-white border border-border text-brand-blue hover:bg-secondary transition-colors shadow-sm"
          >
            {lang === "en" ? "हिं" : "EN"}
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl space-y-4 fade-in">
          {/* Candidate Card */}
          <div className="card-glass rounded-2xl p-4 sm:p-5 md:p-6">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
              {t.candidateProfile}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-brand-blue/10 flex items-center justify-center flex-shrink-0">
                  <User className="w-5 h-5 text-brand-blue" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{t.name}</p>
                  <p className="text-sm font-semibold text-foreground truncate">
                    {state.candidateName}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-brand-blue/10 flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-5 h-5 text-brand-blue" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    {t.department}
                  </p>
                  <p className="text-sm font-semibold text-foreground truncate">
                    {state.department}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 sm:col-span-2">
                <div className="w-9 h-9 rounded-full bg-brand-teal/10 flex items-center justify-center flex-shrink-0">
                  <Briefcase className="w-5 h-5 text-brand-teal" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    {t.designation}
                  </p>
                  <p className="text-sm font-semibold text-foreground truncate">
                    {state.designation}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Rules Card */}
          <div className="card-glass rounded-2xl p-4 sm:p-5 md:p-6">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
              {t.interviewGuidelines}
            </h2>
            <ul className="space-y-3">
              {t.rules.map((rule) => (
                <li key={rule} className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-brand-blue/10 flex items-center justify-center mt-0.5 flex-shrink-0">
                    <Mic className="w-2.5 h-2.5 text-brand-blue" />
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {rule}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          {/* Consent + CTA */}
          <div className="card-glass rounded-2xl p-4 sm:p-5 md:p-6">
            <div className="flex items-start gap-3 mb-5">
              <Checkbox
                id="consent"
                data-ocid="intro.checkbox"
                checked={agreed}
                onCheckedChange={(v) => setAgreed(!!v)}
                className="mt-0.5 border-border data-[state=checked]:bg-brand-blue data-[state=checked]:border-brand-blue flex-shrink-0"
              />
              <label
                htmlFor="consent"
                className="text-sm text-muted-foreground cursor-pointer leading-relaxed"
              >
                {t.consentText}
              </label>
            </div>

            <Button
              data-ocid="intro.primary_button"
              className="w-full bg-brand-blue hover:bg-brand-blue/90 text-white font-medium h-11 min-h-[44px] disabled:opacity-40"
              disabled={!agreed || requestingMic}
              onClick={handleStart}
            >
              {requestingMic ? t.requestingMic : t.startInterview}
            </Button>
          </div>

          <p className="text-center text-xs text-muted-foreground pb-4">
            {t.footer}
          </p>
        </div>
      </main>
    </div>
  );
}
