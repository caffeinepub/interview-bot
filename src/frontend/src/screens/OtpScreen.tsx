import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrainCircuit, Loader2, Mail, Shield } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "../AppContext";
import { useLang } from "../LanguageContext";
import { initInterview, requestOtp, verifyOtp } from "../api";

export default function OtpScreen() {
  const { state, setState } = useApp();
  const { t, lang, toggleLang } = useLang();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const startCooldown = () => {
    let timer = 60;
    setResendCooldown(timer);
    const interval = setInterval(() => {
      timer--;
      setResendCooldown(timer);
      if (timer <= 0) clearInterval(interval);
    }, 1000);
  };

  const handleSendOtp = async () => {
    if (!email.trim()) return toast.error("Please enter your email address");
    setLoading(true);
    try {
      const res = await requestOtp(state.interviewId, email.trim());
      if (res.success) {
        setOtpSent(true);
        startCooldown();
        toast.success("OTP sent to your email!");
      } else {
        toast.error(res.message || "Failed to send OTP");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(
        msg || "Failed to send OTP. Please check your interview link.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp.trim() || otp.length < 4)
      return toast.error("Please enter the OTP");
    setLoading(true);
    try {
      const res = await verifyOtp(state.interviewId, email.trim(), otp.trim());
      if (res.success) {
        const data = await initInterview(state.interviewId, res.token);
        setState({
          token: res.token,
          candidateName: data.candidateName,
          candidateEmail: data.candidateEmail,
          department: data.department,
          designation: data.designation,
          questions: data.questions,
          maxSwitch: data.maxSwitch ?? 10,
          screen: "intro",
        });
        toast.success("Verified! Loading your interview...");
      } else {
        toast.error(res.message || "Invalid OTP");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg || "Verification failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background glow-bg flex flex-col items-center justify-center p-4 overflow-x-hidden">
      {/* Language toggle - positioned relative to header flow, not overlapping brand */}
      <div className="w-full max-w-md flex justify-end mb-4">
        <button
          type="button"
          onClick={toggleLang}
          className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white border border-border text-brand-blue hover:bg-secondary transition-colors shadow-sm"
        >
          {lang === "en" ? "हिं" : "EN"}
        </button>
      </div>

      {/* Brand */}
      <div className="flex items-center gap-2.5 mb-6 sm:mb-8">
        <div className="w-10 h-10 rounded-xl bg-brand-blue flex items-center justify-center shadow-glow">
          <BrainCircuit className="w-6 h-6 text-white" />
        </div>
        <span className="text-xl sm:text-2xl font-bold gradient-brand">
          {t.brandName}
        </span>
      </div>

      {/* Card */}
      <div className="otp-gradient-border w-full max-w-md fade-in">
        <div className="bg-white rounded-[18px] p-4 sm:p-6 md:p-8 shadow-card">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-brand-blue/10 flex items-center justify-center flex-shrink-0">
              <Shield className="w-5 h-5 text-brand-blue" />
            </div>
            <h1 className="text-lg sm:text-xl font-semibold text-foreground">
              {t.candidateVerification}
            </h1>
          </div>
          <p className="text-muted-foreground text-sm mb-5 sm:mb-6">
            {t.enterEmailDesc}
          </p>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label
                htmlFor="email"
                className="text-muted-foreground text-xs uppercase tracking-wider"
              >
                {t.emailAddress}
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="email"
                  data-ocid="otp.input"
                  type="email"
                  placeholder={t.emailPlaceholder}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={otpSent}
                  className="pl-10 bg-secondary border-border text-foreground placeholder:text-muted-foreground"
                  onKeyDown={(e) =>
                    e.key === "Enter" && !otpSent && handleSendOtp()
                  }
                />
              </div>
            </div>

            {!otpSent ? (
              <Button
                data-ocid="otp.primary_button"
                className="w-full bg-brand-blue hover:bg-brand-blue/90 text-white font-medium"
                onClick={handleSendOtp}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : null}
                {loading ? t.sending : t.sendOtp}
              </Button>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="otp"
                    className="text-muted-foreground text-xs uppercase tracking-wider"
                  >
                    {t.enterOtp}
                  </Label>
                  <Input
                    id="otp"
                    data-ocid="otp.search_input"
                    type="text"
                    inputMode="numeric"
                    placeholder={t.otpPlaceholder}
                    value={otp}
                    onChange={(e) =>
                      setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    className="bg-secondary border-border text-foreground placeholder:text-muted-foreground text-center text-xl tracking-widest font-mono"
                    onKeyDown={(e) => e.key === "Enter" && handleVerifyOtp()}
                  />
                </div>

                <Button
                  data-ocid="otp.submit_button"
                  className="w-full bg-brand-blue hover:bg-brand-blue/90 text-white font-medium"
                  onClick={handleVerifyOtp}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : null}
                  {loading ? t.verifying : t.verifyOtp}
                </Button>

                <div className="text-center">
                  {resendCooldown > 0 ? (
                    <span className="text-muted-foreground text-sm">
                      {t.resendIn} {resendCooldown}s
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="text-brand-blue text-sm hover:underline font-medium"
                      onClick={handleSendOtp}
                    >
                      {t.resendOtp}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="mt-6 sm:mt-8 text-muted-foreground text-xs text-center">
        {t.securePortal}{" "}
        <span className="text-brand-blue font-medium">{t.brandName}</span>
      </p>

      <p className="mt-3 text-muted-foreground text-xs text-center">
        {t.footer}
      </p>
    </div>
  );
}
