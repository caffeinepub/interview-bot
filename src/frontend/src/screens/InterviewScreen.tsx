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
  Eye,
  LogOut,
  Mic,
  SkipForward,
  Volume2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useApp } from "../AppContext";
import { useLang } from "../LanguageContext";

const QUESTION_DURATION = 120;
const AUDIO_BARS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

// Detect if text contains Devanagari (Hindi) characters
const isHindiText = (text: string) => /[\u0900-\u097F]/.test(text);

export default function InterviewScreen() {
  const { state, setState } = useApp();
  const { t, lang, toggleLang } = useLang();
  const { questions, candidateName, department, designation, maxSwitch } =
    state;

  const [currentIdx, setCurrentIdx] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [timeLeft, setTimeLeft] = useState(QUESTION_DURATION);
  const [switchCount, setSwitchCount] = useState(0);
  const [showForcedQuit, setShowForcedQuit] = useState(false);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Interval to keep Chrome speechSynthesis alive (Chrome bug: pauses after ~15s)
  const ttsKeepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Safety fallback timeout in case onend never fires (Hindi voices on Chrome)
  const ttsFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingStarted = useRef(false);
  const navigating = useRef(false);
  const spokenIdxRef = useRef(-1);
  const goNextRef = useRef<() => void>(() => {});
  // Debounce ref for screen switch tracking — prevents double-counting
  const lastSwitchTime = useRef(0);

  // AudioContext refs for mixing TTS marker + mic into one stream
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  // Ref to stop the currently-playing TTS oscillator (question marker tone)
  const ttsOscillatorRef = useRef<OscillatorNode | null>(null);
  const ttsGainRef = useRef<GainNode | null>(null);

  const totalQuestions = questions.length;
  const currentQuestion = questions[currentIdx];
  const progressPercent =
    ((QUESTION_DURATION - timeLeft) / QUESTION_DURATION) * 100;
  const overallProgress = Math.round((currentIdx / totalQuestions) * 100);

  // Stop the keep-alive interval
  const stopTtsKeepAlive = useCallback(() => {
    if (ttsKeepAliveRef.current) {
      clearInterval(ttsKeepAliveRef.current);
      ttsKeepAliveRef.current = null;
    }
  }, []);

  // Stop the safety fallback timeout
  const stopTtsFallback = useCallback(() => {
    if (ttsFallbackRef.current) {
      clearTimeout(ttsFallbackRef.current);
      ttsFallbackRef.current = null;
    }
  }, []);

  // Stop any active TTS tone oscillator
  const stopTtsTone = useCallback(() => {
    try {
      if (ttsOscillatorRef.current) {
        ttsOscillatorRef.current.stop();
        ttsOscillatorRef.current.disconnect();
        ttsOscillatorRef.current = null;
      }
      if (ttsGainRef.current) {
        ttsGainRef.current.disconnect();
        ttsGainRef.current = null;
      }
    } catch (_) {
      // ignore if already stopped
    }
  }, []);

  // --- Screen switch tracking ---
  // Bug fix: debounce within 500ms so visibilitychange + blur firing together
  // only counts as ONE switch. Also only count visibilitychange when hiding.
  useEffect(() => {
    const onHide = () => {
      // Only count when tab goes hidden, not when it comes back
      if (!document.hidden) return;
      const now = Date.now();
      if (now - lastSwitchTime.current < 500) return; // debounce
      lastSwitchTime.current = now;
      setSwitchCount((c) => {
        const next = c + 1;
        if (next >= 7 && next < maxSwitch)
          toast.warning(
            `Tab switch ${next}/${maxSwitch}. Limit se zyada hone par auto-submit hoga.`,
          );
        if (next >= maxSwitch) setShowForcedQuit(true);
        return next;
      });
    };
    const onBlur = () => {
      const now = Date.now();
      if (now - lastSwitchTime.current < 500) return; // debounce
      lastSwitchTime.current = now;
      setSwitchCount((c) => {
        const next = c + 1;
        if (next >= 7 && next < maxSwitch)
          toast.warning(`Window switch ${next}/${maxSwitch}.`);
        if (next >= maxSwitch) setShowForcedQuit(true);
        return next;
      });
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("blur", onBlur);
    };
  }, [maxSwitch]);

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimeLeft(QUESTION_DURATION);
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          goNextRef.current();
          return QUESTION_DURATION;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const speakQuestion = useCallback(
    (text: string, idx: number, onDone: () => void) => {
      if (!window.speechSynthesis) {
        onDone();
        return;
      }

      // Cancel any ongoing speech, clear keep-alive, fallback, and stop previous tone
      window.speechSynthesis.cancel();
      stopTtsKeepAlive();
      stopTtsFallback();
      stopTtsTone();

      // Build voice-assistant style announcement with question number
      const prefix = lang === "hi" ? `प्रश्न ${idx}. ` : `Question ${idx}. `;
      const announcement = prefix + text;

      const utterance = new SpeechSynthesisUtterance(announcement);

      // Use Hindi voice if UI lang is Hindi OR if the question text itself contains Devanagari
      const useHindi = lang === "hi" || isHindiText(text);

      // Select best available voice
      const voices = window.speechSynthesis.getVoices();
      if (useHindi) {
        const hiVoice = voices.find(
          (v) => v.lang.startsWith("hi-IN") || v.lang.startsWith("hi"),
        );
        if (hiVoice) utterance.voice = hiVoice;
        utterance.lang = "hi-IN";
      } else {
        const enVoice =
          voices.find((v) => v.lang === "en-IN") ||
          voices.find((v) => v.lang.startsWith("en-GB")) ||
          voices.find((v) => v.lang.startsWith("en-US")) ||
          voices.find((v) => v.lang.startsWith("en"));
        if (enVoice) utterance.voice = enVoice;
        utterance.lang = "en-IN";
      }

      // Slower rate (0.75) for clearer pronunciation; neutral pitch sounds more natural at slow rate
      utterance.rate = 0.75;
      utterance.pitch = 1.0;
      utterance.volume = 1;

      // Start a low-volume marker tone through AudioContext while TTS is speaking.
      // This embeds a gentle 440Hz signal into the mixed recording so both sides
      // (question read-aloud + candidate answer) are captured in one audio file.
      const audioCtx = audioCtxRef.current;
      const dest = audioDestRef.current;
      if (audioCtx && dest) {
        try {
          const gainNode = audioCtx.createGain();
          gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime); // Very soft marker tone
          gainNode.connect(dest);

          const osc = audioCtx.createOscillator();
          osc.type = "sine";
          osc.frequency.setValueAtTime(440, audioCtx.currentTime);
          osc.connect(gainNode);
          osc.start(audioCtx.currentTime);

          ttsOscillatorRef.current = osc;
          ttsGainRef.current = gainNode;
        } catch (_) {
          // AudioContext might not be available; silently skip tone
        }
      }

      utterance.onend = () => {
        stopTtsKeepAlive();
        stopTtsFallback(); // Clear safety fallback — onend fired normally
        stopTtsTone(); // Stop marker tone when question finishes
        setIsSpeaking(false);
        onDone();
      };
      utterance.onerror = () => {
        stopTtsKeepAlive();
        stopTtsFallback();
        stopTtsTone();
        setIsSpeaking(false);
        onDone();
      };

      setIsSpeaking(true);
      window.speechSynthesis.speak(utterance);

      // Chrome bug fix: speechSynthesis silently pauses after ~15 seconds.
      // Only call resume() — do NOT pause() first, as pause()+resume() breaks
      // Hindi voices on Chrome (causes onend to never fire or restarts utterance).
      ttsKeepAliveRef.current = setInterval(() => {
        if (window.speechSynthesis.speaking) {
          window.speechSynthesis.resume(); // resume only, no pause
        } else {
          stopTtsKeepAlive();
        }
      }, 10000);

      // Safety fallback: if onend never fires (common with Hindi voices on Chrome),
      // force-complete TTS after estimated duration + buffer.
      // ~3 chars/sec at rate 0.75, +5s safety buffer, minimum 8s.
      const estimatedMs = Math.max(
        8000,
        (announcement.length / (3 * utterance.rate)) * 1000 + 5000,
      );
      ttsFallbackRef.current = setTimeout(() => {
        if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();
        stopTtsKeepAlive();
        stopTtsFallback();
        stopTtsTone();
        setIsSpeaking(false);
        onDone();
      }, estimatedMs);
    },
    [lang, stopTtsKeepAlive, stopTtsFallback, stopTtsTone],
  );

  useEffect(() => {
    if (recordingStarted.current) return;
    recordingStarted.current = true;
    (async () => {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        streamRef.current = micStream;

        // Try to set up AudioContext mixing (mic + TTS tone in one stream)
        let recordStream: MediaStream = micStream;
        try {
          const audioCtx = new AudioContext();
          audioCtxRef.current = audioCtx;

          const dest = audioCtx.createMediaStreamDestination();
          audioDestRef.current = dest;

          // Connect mic source to mixed destination
          const micSource = audioCtx.createMediaStreamSource(micStream);
          micSource.connect(dest);

          // Use mixed destination stream for recording
          recordStream = dest.stream;
        } catch (_) {
          // AudioContext not supported; fall back to plain mic stream
          audioCtxRef.current = null;
          audioDestRef.current = null;
        }

        // Choose best available mimeType
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";

        const mr = new MediaRecorder(recordStream, { mimeType });
        mr.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        mr.start(250);
        mediaRecorderRef.current = mr;
        setIsRecording(true);
        spokenIdxRef.current = 0;
        speakQuestion(questions[0]?.question || "", 1, () => startTimer());
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
    })();
  }, [t, startTimer, speakQuestion, questions]);

  useEffect(() => {
    if (spokenIdxRef.current === currentIdx) return;
    spokenIdxRef.current = currentIdx;
    speakQuestion(questions[currentIdx]?.question || "", currentIdx + 1, () =>
      startTimer(),
    );
  }, [currentIdx, speakQuestion, startTimer, questions]);

  const finishInterview = useCallback(
    (uids: string[], sc: number) => {
      if (timerRef.current) clearInterval(timerRef.current);
      stopTtsKeepAlive();
      stopTtsFallback();
      stopTtsTone();
      window.speechSynthesis?.cancel();
      setIsSpeaking(false);
      const mr = mediaRecorderRef.current;
      const doFinish = () => {
        // Close AudioContext after recording stops
        audioCtxRef.current?.close().catch(() => {});
        audioCtxRef.current = null;
        audioDestRef.current = null;

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setState({
          screen: "upload",
          recordedBlob: blob,
          selectedQuestionUIDs: uids,
          screenSwitchCount: sc,
        });
      };
      if (mr && mr.state !== "inactive") {
        mr.onstop = () => {
          if (streamRef.current)
            for (const track of streamRef.current.getTracks()) track.stop();
          doFinish();
        };
        mr.stop();
      } else {
        doFinish();
      }
    },
    [setState, stopTtsKeepAlive, stopTtsFallback, stopTtsTone],
  );

  // Cleanup AudioContext and fallback timeout on unmount
  useEffect(() => {
    return () => {
      stopTtsTone();
      stopTtsFallback();
      audioCtxRef.current?.close().catch(() => {});
    };
  }, [stopTtsTone, stopTtsFallback]);

  const goNext = useCallback(() => {
    if (navigating.current) return;
    navigating.current = true;
    stopTtsKeepAlive();
    stopTtsFallback();
    stopTtsTone();
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
    if (timerRef.current) clearInterval(timerRef.current);

    setCurrentIdx((idx) => {
      const next = idx + 1;
      if (next >= totalQuestions) {
        finishInterview(
          questions.map((q) => q.uid),
          switchCount,
        );
        return idx;
      }
      setTimeout(() => {
        navigating.current = false;
      }, 50);
      return next;
    });
  }, [
    totalQuestions,
    questions,
    switchCount,
    finishInterview,
    stopTtsKeepAlive,
    stopTtsFallback,
    stopTtsTone,
  ]);

  goNextRef.current = goNext;

  const handleSkipClick = () => {
    if (navigating.current || isSpeaking) return;
    setShowSkipConfirm(true);
  };

  const handleSkipConfirm = () => {
    setShowSkipConfirm(false);
    goNext();
  };

  const handleFinishClick = () => setShowFinishConfirm(true);

  const handleFinishConfirm = () => {
    setShowFinishConfirm(false);
    finishInterview(
      questions.slice(0, currentIdx + 1).map((q) => q.uid),
      switchCount,
    );
  };

  const handleForceSubmit = () => {
    setShowForcedQuit(false);
    finishInterview(
      questions.map((q) => q.uid),
      switchCount,
    );
  };

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  // Pill color based on switch count
  const switchPillClass =
    switchCount >= 7
      ? "bg-status-red/10 text-status-red border-status-red/30"
      : switchCount > 0
        ? "bg-status-amber/15 text-status-amber border-status-amber/35"
        : "bg-secondary text-muted-foreground border-border";

  return (
    <div className="min-h-screen bg-background flex flex-col overflow-x-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between px-3 sm:px-8 py-3 border-b border-border bg-white/95 backdrop-blur-sm sticky top-0 z-10">
        {/* Brand */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-brand-blue flex items-center justify-center shadow-sm flex-shrink-0">
            <BrainCircuit className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold gradient-brand text-sm hidden sm:inline truncate">
            {t.brandName}
          </span>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          {/* Screen switch count - always visible */}
          <div
            className={`flex items-center gap-1 px-2 py-1 rounded-full border text-xs font-semibold ${switchPillClass}`}
            data-ocid="interview.switch_count.panel"
          >
            <Eye className="w-3 h-3 flex-shrink-0" />
            <span className="hidden sm:inline">Tab Switches:&nbsp;</span>
            <span>
              {switchCount}/{maxSwitch}
            </span>
          </div>

          {/* Language toggle */}
          <button
            type="button"
            onClick={toggleLang}
            className="text-xs font-semibold px-2 sm:px-2.5 py-1 rounded-full bg-white border border-border text-brand-blue hover:bg-secondary transition-colors"
          >
            {lang === "en" ? "हिं" : "EN"}
          </button>

          {/* Finish button */}
          <Button
            size="sm"
            variant="destructive"
            className="bg-status-red hover:bg-status-red/90 text-white text-xs h-8 px-2 sm:px-3"
            onClick={handleFinishClick}
          >
            <LogOut className="w-3 h-3 sm:mr-1" />
            <span className="hidden sm:inline">{t.finishInterview}</span>
          </Button>
        </div>
      </header>

      {/* Overall progress strip */}
      <div className="h-1 bg-border">
        <div
          className="h-full bg-brand-blue transition-all duration-500"
          style={{ width: `${overallProgress}%` }}
        />
      </div>

      {/* Warning banner */}
      {switchCount >= 7 && switchCount < maxSwitch && (
        <div className="mx-3 sm:mx-4 mt-3 bg-status-amber/10 border border-status-amber/25 rounded-xl px-3 sm:px-4 py-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-status-amber flex-shrink-0" />
          <p className="text-xs sm:text-sm text-status-amber">
            {t.tabSwitchWarning} {switchCount}/{maxSwitch} {t.tabSwitchWarning3}
          </p>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center px-3 sm:px-8 py-4 sm:py-6 max-w-3xl mx-auto w-full">
        {/* Top row: badges + counter */}
        <div className="flex items-center justify-between w-full mb-4 gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Badge className="bg-brand-blue/10 text-brand-blue border-brand-blue/20 text-xs truncate max-w-[90px] sm:max-w-none">
              {department}
            </Badge>
            <Badge className="bg-brand-teal/10 text-brand-teal border-brand-teal/20 text-xs truncate max-w-[90px] sm:max-w-none">
              {designation}
            </Badge>
          </div>
          <span className="text-xs sm:text-sm text-muted-foreground font-medium flex-shrink-0">
            {t.question}{" "}
            <span className="text-foreground font-bold">{currentIdx + 1}</span>{" "}
            / {totalQuestions}
          </span>
        </div>

        {/* Question card */}
        <div className="w-full card-glass rounded-2xl overflow-hidden shadow-sm mb-4">
          <div className="px-4 sm:px-5 pt-4 sm:pt-5 pb-2 flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wide truncate">
              {currentQuestion?.questionType || "General"}
            </span>
            {isSpeaking ? (
              <div className="flex items-center gap-1.5 text-brand-blue flex-shrink-0">
                <Volume2 className="w-3.5 h-3.5 animate-pulse" />
                <span className="text-xs font-semibold">
                  {lang === "hi" ? "सुनें..." : "Listening..."}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                <span
                  className={`font-mono text-sm font-bold ${
                    timeLeft < 30
                      ? "text-status-red"
                      : timeLeft < 60
                        ? "text-status-amber"
                        : "text-foreground"
                  }`}
                >
                  {fmt(timeLeft)}
                </span>
              </div>
            )}
          </div>
          <div className="px-4 sm:px-5 pb-4">
            <Progress
              value={isSpeaking ? 0 : progressPercent}
              className={`h-1.5 bg-border ${
                timeLeft < 30
                  ? "[&>div]:bg-status-red"
                  : timeLeft < 60
                    ? "[&>div]:bg-status-amber"
                    : "[&>div]:bg-brand-blue"
              }`}
            />
          </div>
          <div className="px-4 sm:px-5 pb-5 sm:pb-6">
            <p className="text-lg sm:text-xl md:text-2xl font-semibold text-foreground leading-relaxed">
              {currentQuestion?.question}
            </p>
          </div>
        </div>

        {/* Recording / Speaking indicator — always shows red dot when mic is active */}
        <div className="w-full card-glass rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-center mb-4 min-h-[100px]">
          {isRecording ? (
            <>
              {/* Red blinking dot + label — always visible while recording */}
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-3 h-3 rounded-full bg-status-red pulse-recording flex-shrink-0" />
                <span className="text-sm font-semibold text-status-red">
                  {t.recording}
                </span>
              </div>

              {/* Context-aware secondary status */}
              {isSpeaking ? (
                <>
                  {/* During TTS: show speaking wave + message */}
                  <div className="flex items-center gap-2 mb-2">
                    <Volume2 className="w-4 h-4 text-brand-blue animate-pulse" />
                    <span className="text-sm font-medium text-brand-blue">
                      {lang === "hi"
                        ? "प्रश्न पढ़ा जा रहा है..."
                        : "Reading question aloud..."}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    {lang === "hi"
                      ? "माइक्रोफोन चालू है — आपकी आवाज़ रिकॉर्ड हो रही है"
                      : "Mic is live — your audio is being recorded"}
                  </p>
                </>
              ) : (
                <>
                  {/* During answer: show animated bars + mic active label */}
                  <div className="flex items-end gap-1 h-10 mb-3">
                    {AUDIO_BARS.map((i) => (
                      <div
                        key={i}
                        className="w-1.5 bg-brand-blue rounded-full audio-bar"
                        style={{
                          height: `${30 + ((i * 7) % 60)}%`,
                          animationDelay: `${i * 0.07}s`,
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
              )}
            </>
          ) : (
            <>
              <div className="w-12 h-12 rounded-full bg-brand-blue/10 flex items-center justify-center mb-2">
                <Mic className="w-6 h-6 text-brand-blue" />
              </div>
              <p className="text-xs text-muted-foreground">
                Microphone access needed
              </p>
            </>
          )}
        </div>

        {/* Action buttons */}
        <div className="w-full flex gap-2 sm:gap-3">
          <Button
            variant="outline"
            className="flex-1 border-border text-muted-foreground hover:text-foreground min-h-[44px] text-sm"
            onClick={handleSkipClick}
            disabled={isSpeaking}
            data-ocid="interview.skip_question.button"
          >
            <SkipForward className="w-4 h-4 mr-1.5 flex-shrink-0" />
            <span className="truncate">{t.skipQuestion}</span>
          </Button>
          <Button
            className="flex-1 bg-brand-blue hover:bg-brand-blue/90 text-white border-0 min-h-[44px] text-sm"
            onClick={goNext}
            disabled={!isRecording || isSpeaking}
            data-ocid="interview.next_question.button"
          >
            <ChevronRight className="w-4 h-4 mr-1.5 flex-shrink-0" />
            <span className="truncate">
              {currentIdx + 1 >= totalQuestions ? t.finish : t.nextQuestion}
            </span>
          </Button>
        </div>

        <p className="text-xs text-muted-foreground mt-4 text-center">
          {candidateName} &bull; {department}
        </p>
      </main>

      {/* Skip Confirm */}
      <Dialog open={showSkipConfirm} onOpenChange={setShowSkipConfirm}>
        <DialogContent className="bg-white border-border max-w-sm mx-4 w-[calc(100vw-2rem)]">
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
              variant="outline"
              className="border-border"
              onClick={() => setShowSkipConfirm(false)}
            >
              {t.cancel}
            </Button>
            <Button
              className="bg-status-amber hover:bg-status-amber/90 text-white"
              onClick={handleSkipConfirm}
            >
              {t.skipConfirmYes}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Force quit */}
      <Dialog open={showForcedQuit}>
        <DialogContent className="bg-white border-border max-w-sm mx-4 w-[calc(100vw-2rem)]">
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
              className="bg-status-red hover:bg-status-red/90 text-white"
              onClick={handleForceSubmit}
            >
              {t.submitNow}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Finish confirm */}
      <Dialog open={showFinishConfirm} onOpenChange={setShowFinishConfirm}>
        <DialogContent className="bg-white border-border max-w-sm mx-4 w-[calc(100vw-2rem)]">
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
              variant="outline"
              className="border-border"
              onClick={() => setShowFinishConfirm(false)}
            >
              {t.continueInterview}
            </Button>
            <Button
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
