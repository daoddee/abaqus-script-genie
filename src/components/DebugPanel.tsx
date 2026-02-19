import { useState } from "react";
import { Bug, Loader2, ChevronRight, AlertTriangle, CheckCircle2, Copy, Check } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./ui/collapsible";
import { toast } from "sonner";

const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/debug-abaqus-script`;

interface DebugResult {
  root_cause: string[];
  fix_strategy: string[];
  corrected_script: string;
  post_run_checks: string[];
  error_class: string;
  changes_summary: string;
}

interface DebugPanelProps {
  script: string;
  onApplyFix: (correctedScript: string) => void;
}

const ERROR_CLASS_COLORS: Record<string, string> = {
  SelectionEmpty: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  WrongRegionType: "text-orange-400 bg-orange-400/10 border-orange-400/20",
  MissingImport: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  WrongKeywordSignature: "text-purple-400 bg-purple-400/10 border-purple-400/20",
  Overconstraint: "text-red-400 bg-red-400/10 border-red-400/20",
  MeshFailure: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
  StepMisassignment: "text-cyan-400 bg-cyan-400/10 border-cyan-400/20",
  Other: "text-muted-foreground bg-muted/50 border-border",
};

const DebugPanel = ({ script, onApplyFix }: DebugPanelProps) => {
  const [errorLog, setErrorLog] = useState("");
  const [intent, setIntent] = useState("");
  const [isDebugging, setIsDebugging] = useState(false);
  const [result, setResult] = useState<DebugResult | null>(null);
  const [copied, setCopied] = useState(false);

  const handleDebug = async () => {
    if (!errorLog.trim()) {
      toast.error("Paste the Abaqus error log first");
      return;
    }

    setIsDebugging(true);
    setResult(null);

    try {
      const resp = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          script,
          error_log: errorLog,
          intent: intent || undefined,
        }),
      });

      const data = await resp.json();

      if (!data.ok || !data.data) {
        toast.error(data.issues?.[0] || "Debug failed");
        return;
      }

      setResult(data.data);
      toast.success(`Diagnosed: ${data.data.error_class}`);
    } catch (e) {
      console.error("Debug error:", e);
      toast.error("Debug request failed");
    } finally {
      setIsDebugging(false);
    }
  };

  const handleApply = () => {
    if (result?.corrected_script) {
      onApplyFix(result.corrected_script);
      toast.success("Fix applied to script preview");
    }
  };

  const handleCopyScript = async () => {
    if (!result?.corrected_script) return;
    await navigator.clipboard.writeText(result.corrected_script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const colorClass = result ? (ERROR_CLASS_COLORS[result.error_class] || ERROR_CLASS_COLORS.Other) : "";

  return (
    <div className="flex flex-col h-full">
      {/* Input section */}
      <div className="p-3 space-y-2 border-b border-border">
        <textarea
          value={errorLog}
          onChange={(e) => setErrorLog(e.target.value)}
          placeholder="Paste Abaqus error log (.msg / .dat / CAE console output)..."
          className="w-full h-24 bg-muted border border-border rounded-md px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none scrollbar-thin"
        />
        <input
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          placeholder="Model intent (optional): e.g. 'Plate with hole, pressure on top'"
          className="w-full bg-muted border border-border rounded-md px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        <button
          onClick={handleDebug}
          disabled={isDebugging || !errorLog.trim()}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs bg-destructive/15 text-destructive border border-destructive/20 hover:bg-destructive/25 transition-colors disabled:opacity-40"
        >
          {isDebugging ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Bug className="w-3.5 h-3.5" />
          )}
          {isDebugging ? "Diagnosing..." : "Debug Script"}
        </button>
      </div>

      {/* Results */}
      {result && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin">
          {/* Error class badge */}
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase border ${colorClass}`}>
              {result.error_class}
            </span>
            {result.changes_summary && (
              <span className="text-xs text-muted-foreground truncate">{result.changes_summary}</span>
            )}
          </div>

          {/* Root cause */}
          <Collapsible defaultOpen>
            <CollapsibleTrigger className="flex items-center gap-1.5 text-xs font-medium text-foreground group w-full text-left">
              <ChevronRight className="w-3 h-3 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
              <AlertTriangle className="w-3 h-3 text-destructive" />
              Root Cause
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="mt-1 ml-5 space-y-1">
                {result.root_cause.map((item, i) => (
                  <li key={i} className="text-xs text-muted-foreground">• {item}</li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>

          {/* Fix strategy */}
          <Collapsible defaultOpen>
            <CollapsibleTrigger className="flex items-center gap-1.5 text-xs font-medium text-foreground group w-full text-left">
              <ChevronRight className="w-3 h-3 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
              <CheckCircle2 className="w-3 h-3 text-primary" />
              Fix Strategy
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="mt-1 ml-5 space-y-1">
                {result.fix_strategy.map((item, i) => (
                  <li key={i} className="text-xs text-muted-foreground">{i + 1}. {item}</li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>

          {/* Post-run checks */}
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-1.5 text-xs font-medium text-foreground group w-full text-left">
              <ChevronRight className="w-3 h-3 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
              Post-Run Checks
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="mt-1 ml-5 space-y-1">
                {result.post_run_checks.map((item, i) => (
                  <li key={i} className="text-xs text-muted-foreground">✓ {item}</li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <button
              onClick={handleApply}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-primary/15 text-primary border border-primary/20 hover:bg-primary/25 transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Apply Fix
            </button>
            <button
              onClick={handleCopyScript}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy Fixed Script"}
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!result && !isDebugging && (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground space-y-2 p-4">
          <Bug className="w-10 h-10 opacity-20" />
          <p className="text-xs text-center">
            Paste an Abaqus error log above to auto-diagnose and fix your script
          </p>
        </div>
      )}
    </div>
  );
};

export default DebugPanel;
