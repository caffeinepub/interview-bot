import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  ChevronRight,
  Clock,
  LogOut,
  Mic,
  SkipForward,
  User,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useApp } from "../AppContext";
import { useLang } from "../LanguageContext";
import { ttsSynthesize } from "../api";

const QUESTION_DURATION = 120; // 2 minutes
const AUDIO_BARS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

export default function InterviewScreen() {
  const { state, setState } = useApp();
  const { t, lang, toggleLang } = useLang();
  const {
    questions,
    candidateName,
    department,
    designation,
    token,
    maxSwitch,
  } = state;

  const [currentIdx, setCurrentIdx] = useState(0);
  const [phase, setPhase] = useState<"idle" | "recording">("idle");
  const [timeLeft, setTimeLeft] = useState(QUESTION_DURATION);
  const [switchCount, setSwitchCount] = useState(0);
  const [showForcedQuit, setShowForcedQuit] = useState(false);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [selectedUIDs, setSelectedUIDs] = useState<string[]>([]);
  const [allChunks, setAllChunks] = useState<Blob[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Prevent double-triggers
  const isTransitioning = useRef(false);
  // Track which idx we already started recording for
  const recordingStartedForIdx = useRef<number>(-1);

  const currentQuestion = questions[currentIdx];
  const totalQuestions = questions.length;
  const progressPercent =
    ((QUESTION_DURATION - timeLeft) / QUESTION_DURATION) * 100;

  // Screen switch tracking
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setSwitchCount((c) => {
          const next = c + 1;
          if (next >= 7 && next < maxSwitch) {
            toast.warning(
              `⚠️ Tab switch detected (${next}/${maxSwitch}). Exceeding limit will auto-submit.`,
            );
          }
          if (next >= maxSwitch) {
            setShowForcedQuit(true);
          }
          return next;
        });
      }
    };
    const handleBlur = () => {
      setSwitchCount((c) => {
        const next = c + 1;
        if (next >= 7 && next < maxSwitch) {
          toast.warning(`⚠️ Window switch detected (${next}/${maxSwitch}).`);
        }
        if (next >= maxSwitch) {
          setShowForcedQuit(true);
        }
        return next;
      });
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleBlur);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
    };
  }, [maxSwitch]);

  const stopRecording = useCallback((): Promise<Blob[]> => {
    return new Promise((resolve) => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        mediaRecorderRef.current.onstop = () => {
          resolve([...chunksRef.current]);
        };
        mediaRecorderRef.current.stop();
      } else {
        resolve([]);
      }
    });
  }, []);

  const finishInterview = useCallback(
    (blobs: Blob[], uids: string[], sc: number) => {
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
      }
      const merged = new Blob(blobs, { type: "audio/webm" });
      setState({
        screen: "upload",
        recordedBlob: merged,
        selectedQuestionUIDs: uids.filter(Boolean),
        screenSwitchCount: sc,
      });
    },
    [setState],
  );

  const handleNext = useCallback(
    async (_reason?: string) => {
      if (isTransitioning.current) return;
      isTransitioning.current = true;

      if (timerRef.current) clearInterval(timerRef.current);
      const chunks = await stopRecording();
      const newAllChunks = [...allChunks, ...chunks];
      const newUIDs = currentQuestion
        ? [...selectedUIDs, currentQuestion.uid]
        : selectedUIDs;
      setAllChunks(newAllChunks);
      if (currentQuestion) {
        setSelectedUIDs(newUIDs);
      }
      setPhase("idle");
      recordingStartedForIdx.current = -1;

      if (currentIdx + 1 >= totalQuestions) {
        finishInterview(newAllChunks, newUIDs, switchCount);
      } else {
        setCurrentIdx((i) => i + 1);
        setTimeLeft(QUESTION_DURATION);
      }

      // Reset after short delay to allow state to settle
      setTimeout(() => {
        isTransitioning.current = false;
      }, 500);
    },
    [
      currentIdx,
      totalQuestions,
      stopRecording,
      currentQuestion,
      allChunks,
      selectedUIDs,
      switchCount,
      finishInterview,
    ],
  );

  // Timer
  useEffect(() => {
    if (phase !== "recording") return;
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          handleNext("timeout");
          return QUESTION_DURATION;
        }
        return t - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase, handleNext]);

  const startRecording = useCallback(async () => {
    try {
      if (currentQuestion && token) {
        try {
          const tts = await ttsSynthesize(currentQuestion.question, token);
          if (tts.audioBase64) {
            const bytes = Uint8Array.from(atob(tts.audioBase64), (c) =>
              c.charCodeAt(0),
            );
            const blob = new Blob([bytes], { type: "audio/mpeg" });
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            await new Promise<void>((res) => {
              audio.onended = () => res();
              audio.onerror = () => res();
              audio.play().catch(() => res());
            });
            URL.revokeObjectURL(url);
          }
        } catch {
          // TTS optional
        }
      }

      let stream = streamRef.current;
      if (
        !stream ||
        stream.getTracks().every((tk) => tk.readyState === "ended")
      ) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
      }

      chunksRef.current = [];
      const mr = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.start(250);
      mediaRecorderRef.current = mr;
      setPhase("recording");
      setTimeLeft(QUESTION_DURATION);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (
        msg.includes("Permission") ||
        msg.includes("NotAllowed") ||
        msg.includes("denied")
      ) {
        toast.error(t.micPermissionError);
      } else {
        toast.error(t.noMicError);
      }
    }
  }, [currentQuestion, token, t]);

  // AUTO-START recording when question changes
  useEffect(() => {
    if (recordingStartedForIdx.current === currentIdx) return;
    if (isTransitioning.current) return;
    recordingStartedForIdx.current = currentIdx;
    startRecording();
  }, [currentIdx, startRecording]);

  const handleSkipClick = () => {
    if (isTransitioning.current) return;
    setShowSkipConfirm(true);
  };

  const handleSkipConfirm = async () => {
    setShowSkipConfirm(false);
    await handleNext("skip");
  };

  const handleFinishClick = () => setShowFinishConfirm(true);

  const handleForceSubmit = async () => {
    setShowForcedQuit(false);
    if (timerRef.current) clearInterval(timerRef.current);
    const chunks = await stopRecording();
    finishInterview(
      [...allChunks, ...chunks],
      [...selectedUIDs, currentQuestion?.uid ?? ""],
      switchCount,
    );
  };

  const handleFinishConfirm = async () => {
    setShowFinishConfirm(false);
    if (timerRef.current) clearInterval(timerRef.current);
    const chunks = phase === "recording" ? await stopRecording() : [];
    finishInterview(
      [...allChunks, ...chunks],
      [...selectedUIDs, ...(currentQuestion ? [currentQuestion.uid] : [])],
      switchCount,
    );
  };

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between px-3 sm:px-6 py-3 border-b border-border bg-white/90 backdrop-blur-sm sticky top-0 z-10 flex-wrap gap-2">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-7 h-7 rounded-lg bg-brand-blue flex items-center justify-center">
            <BrainCircuit className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold gradient-brand text-sm">
            {t.brandName}
          </span>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          <Badge className="bg-secondary border-border text-muted-foreground text-xs">
            Q{currentIdx + 1} {t.of} {totalQuestions}
          </Badge>
          <Badge className="bg-status-amber/15 text-status-amber border-status-amber/30 text-xs">
            {t.inProgress}
          </Badge>
          {switchCount > 0 && (
            <Badge className="bg-status-red/15 text-status-red border-status-red/30 text-xs">
              <AlertTriangle className="w-3 h-3 mr-1" />
              {switchCount} {t.switches}
            </Badge>
          )}
          <button
            type="button"
            onClick={toggleLang}
            className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white border border-border text-brand-blue hover:bg-secondary transition-colors"
          >
            {lang === "en" ? "हिं" : "EN"}
          </button>
          <Button
            data-ocid="interview.delete_button"
            size="sm"
            variant="destructive"
            className="bg-status-red hover:bg-status-red/90 text-white text-xs h-8"
            onClick={handleFinishClick}
          >
            <LogOut className="w-3 h-3 mr-1" />
            <span className="hidden sm:inline">{t.finishInterview}</span>
            <span className="sm:hidden">{t.finish}</span>
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar - hidden on mobile */}
        <aside className="hidden md:flex w-72 bg-navy border-r border-border flex-col p-4 gap-4 overflow-y-auto">
          <div className="card-glass rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-brand-blue/10 flex items-center justify-center">
                <User className="w-4 h-4 text-brand-blue" />
              </div>
              <div>
                <p className="text-xs font-semibold text-foreground">
                  {candidateName}
                </p>
                <p className="text-xs text-muted-foreground">{department}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Badge className="bg-brand-blue/10 text-brand-blue border-brand-blue/20 text-xs">
                {department}
              </Badge>
              <Badge className="bg-brand-teal/10 text-brand-teal border-brand-teal/20 text-xs">
                {designation}
              </Badge>
            </div>
          </div>

          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2 px-1">
              {t.questions}
            </p>
            <div className="space-y-1.5">
              {questions.map((q, i) => (
                <div
                  key={q.uid}
                  data-ocid={`interview.item.${i + 1}`}
                  className={`rounded-lg px-3 py-2.5 text-xs transition-all ${
                    i === currentIdx
                      ? "bg-brand-blue/15 text-brand-blue border border-brand-blue/25 shadow-sm"
                      : i < currentIdx
                        ? "bg-secondary text-muted-foreground"
                        : "text-muted-foreground/30 blur-[2px] select-none pointer-events-none"
                  }`}
                >
                  <span className="font-medium">Q{i + 1}.</span>{" "}
                  <span className="line-clamp-2">
                    {i <= currentIdx
                      ? `${q.question.slice(0, 55)}${q.question.length > 55 ? "..." : ""}`
                      : "●●●●●●●●●●"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-auto card-glass rounded-xl p-3">
            <p className="text-xs text-muted-foreground mb-1">
              {t.overallProgress}
            </p>
            <Progress
              value={(currentIdx / totalQuestions) * 100}
              className="h-1.5 bg-border [&>div]:bg-brand-blue"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {currentIdx}/{totalQuestions} {t.completed}
            </p>
          </div>
        </aside>

        {/* Main interview area - flex col, no overflow so buttons stay visible */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Warning banner */}
          {switchCount >= 7 && switchCount < maxSwitch && (
            <div className="mx-4 mt-4 bg-status-amber/10 border border-status-amber/25 rounded-xl px-4 py-3 flex items-center gap-2 flex-shrink-0">
              <AlertTriangle className="w-4 h-4 text-status-amber flex-shrink-0" />
              <p className="text-sm text-status-amber">
                {t.tabSwitchWarning} {switchCount} {t.tabSwitchWarning2}{" "}
                {maxSwitch} {t.tabSwitchWarning3}
              </p>
            </div>
          )}

          {/* Question card - takes available space without overflow */}
          <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-hidden">
            <div className="card-glass rounded-2xl flex-1 flex flex-col overflow-hidden">
              {/* Header: badge + timer - no scroll */}
              <div className="p-5 sm:p-6 pb-3 flex items-start justify-between gap-2 flex-wrap flex-shrink-0">
                <div className="flex items-center gap-2">
                  <Badge className="bg-brand-blue/10 text-brand-blue border-brand-blue/20">
                    {currentQuestion?.questionType || "General"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {t.question} {currentIdx + 1} {t.of} {totalQuestions}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span
                    className={`font-mono font-semibold ${
                      timeLeft < 30
                        ? "text-status-red"
                        : timeLeft < 60
                          ? "text-status-amber"
                          : "text-foreground"
                    }`}
                  >
                    {formatTime(timeLeft)}
                  </span>
                </div>
              </div>

              {/* Progress bar - no scroll */}
              <div className="px-5 sm:px-6 pb-3 flex-shrink-0">
                <Progress
                  value={progressPercent}
                  className={`h-2 bg-border ${
                    timeLeft < 30
                      ? "[&>div]:bg-status-red"
                      : timeLeft < 60
                        ? "[&>div]:bg-status-amber"
                        : "[&>div]:bg-brand-blue"
                  }`}
                />
              </div>

              {/* Scrollable middle: question text + recording indicator */}
              <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-2">
                <p className="text-lg sm:text-xl font-semibold text-foreground leading-relaxed mb-5">
                  {currentQuestion?.question}
                </p>

                {/* Recording indicator */}
                <div className="flex flex-col items-center justify-center py-5 rounded-xl bg-secondary/60 border border-border">
                  {phase === "recording" ? (
                    <>
                      <div className="flex items-center gap-2.5 mb-3">
                        <div className="w-3.5 h-3.5 rounded-full bg-status-red pulse-recording" />
                        <span className="text-sm font-semibold text-status-red tracking-wide">
                          {t.recording}
                        </span>
                      </div>
                      <div className="flex items-end gap-1 h-10 mb-3">
                        {AUDIO_BARS.map((barIdx) => (
                          <div
                            key={barIdx}
                            className="w-1.5 bg-brand-blue rounded-full audio-bar"
                            style={{
                              height: `${30 + ((barIdx * 7) % 60)}%`,
                              animationDelay: `${barIdx * 0.07}s`,
                            }}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Activity className="w-3 h-3 text-status-green" />
                        <span className="text-xs text-status-green">
                          {t.audioActive}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-12 h-12 rounded-full bg-brand-blue/10 flex items-center justify-center mb-2">
                        <Mic className="w-6 h-6 text-brand-blue" />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Starting recorder...
                      </p>
                    </>
                  )}
                </div>
              </div>

              {/* Buttons - always at bottom, never scrolled away */}
              <div className="p-4 sm:p-5 pt-3 border-t border-border flex-shrink-0">
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button
                    data-ocid="interview.secondary_button"
                    variant="outline"
                    className="flex-1 border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                    onClick={handleSkipClick}
                    disabled={isTransitioning.current}
                  >
                    <SkipForward className="w-4 h-4 mr-2" />
                    {t.skipQuestion}
                  </Button>
                  <Button
                    data-ocid="interview.save_button"
                    className="flex-1 bg-brand-blue hover:bg-brand-blue/90 text-white border-0"
                    onClick={() => handleNext("next")}
                    disabled={phase === "idle" || isTransitioning.current}
                  >
                    <ChevronRight className="w-4 h-4 mr-2" />
                    {currentIdx + 1 >= totalQuestions
                      ? t.finish
                      : t.nextQuestion}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Skip Confirm Dialog */}
      <Dialog open={showSkipConfirm} onOpenChange={setShowSkipConfirm}>
        <DialogContent
          className="bg-white border-border max-w-sm mx-4"
          data-ocid="interview.dialog"
        >
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {t.skipConfirmTitle}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t.skipConfirmDesc}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 flex-col sm:flex-row">
            <Button
              data-ocid="interview.cancel_button"
              variant="outline"
              className="border-border text-muted-foreground"
              onClick={() => setShowSkipConfirm(false)}
            >
              {t.cancel}
            </Button>
            <Button
              data-ocid="interview.confirm_button"
              className="bg-status-amber hover:bg-status-amber/90 text-white"
              onClick={handleSkipConfirm}
            >
              {t.skipConfirmYes}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Force quit dialog */}
      <Dialog open={showForcedQuit}>
        <DialogContent
          className="bg-white border-border max-w-sm mx-4"
          data-ocid="interview.modal"
        >
          <DialogHeader>
            <DialogTitle className="text-status-red flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              {t.autoSubmitTitle}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t.autoSubmitDesc} ({maxSwitch}).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              data-ocid="interview.confirm_button"
              className="bg-status-red hover:bg-status-red/90 text-white"
              onClick={handleForceSubmit}
            >
              {t.submitNow}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Finish confirm dialog */}
      <Dialog open={showFinishConfirm} onOpenChange={setShowFinishConfirm}>
        <DialogContent
          className="bg-white border-border max-w-sm mx-4"
          data-ocid="interview.modal"
        >
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {t.finishConfirmTitle}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t.finishConfirmDesc} {currentIdx} {t.of} {totalQuestions}{" "}
              {t.questions}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 flex-col sm:flex-row">
            <Button
              data-ocid="interview.cancel_button"
              variant="outline"
              className="border-border text-muted-foreground"
              onClick={() => setShowFinishConfirm(false)}
            >
              {t.continueInterview}
            </Button>
            <Button
              data-ocid="interview.delete_button"
              className="bg-status-red hover:bg-status-red/90 text-white"
              onClick={handleFinishConfirm}
            >
              {t.endSubmit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
