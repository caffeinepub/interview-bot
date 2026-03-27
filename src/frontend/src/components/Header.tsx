import { BrainCircuit } from "lucide-react";

export default function Header() {
  return (
    <header className="flex items-center px-6 py-4 border-b border-border bg-navy">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-brand-blue flex items-center justify-center">
          <BrainCircuit className="w-5 h-5 text-white" />
        </div>
        <span className="text-lg font-semibold gradient-brand">
          AuraHire AI
        </span>
      </div>
    </header>
  );
}
