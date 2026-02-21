import { useState, useRef, useEffect } from "react";
import { Send, Loader2, AlertTriangle, Info, Lock } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useUsageLimit } from "@/hooks/useUsageLimit";
import { useSubscription } from "@/hooks/useSubscription";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  issues?: string[];
  analysisType?: string;
  latencyMs?: number;
}

interface ChatPanelProps {
  onScriptGenerated: (script: string, prompt?: string) => void;
  runtimeMode?: "py3" | "py27";
}

interface ModelPlan {
  geometry_strategy: string;
  mesh_strategy: string;
  bc_strategy: string;
  load_strategy: string;
  selection_strategy: string;
  postprocessing: string;
}

interface GenerateResponse {
  ok: boolean;
  data?: {
    title: string;
    assumptions: string[];
    script: string;
    notes: string[];
    abaqus_version: string | null;
    units: string | null;
    plan?: ModelPlan;
  };
  analysis_type?: string;
  issues?: string[];
  trace_id: string;
  latency_ms?: number;
}

const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-abaqus-script`;

const ChatPanel = ({ onScriptGenerated, runtimeMode = "py3" }: ChatPanelProps) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { canGenerate, remaining, freeLimit, recordUsage } = useUsageLimit();
  const { subscribed } = useSubscription();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isGenerating]);

  const handleSend = async () => {
    if (!input.trim() || isGenerating) return;

    // Check usage limit (subscribed users bypass)
    if (!subscribed && !canGenerate) {
      setShowPaywall(true);
      return;
    }

    const userPrompt = input;
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: userPrompt,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsGenerating(true);

    try {
      const resp = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ prompt: userPrompt, runtime_mode: runtimeMode }),
      });

      const result: GenerateResponse = await resp.json();

      if (!result.ok || !result.data) {
        const errorIssues = result.issues || ["Generation failed. Please try again."];
        const errMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: errorIssues.join("\n"),
          timestamp: new Date(),
          issues: errorIssues,
        };
        setMessages((prev) => [...prev, errMsg]);
        toast.error("Script generation failed");
        return;
      }

      // Success — build rich assistant message
      const { data, analysis_type, issues, latency_ms } = result;

      const lines: string[] = [];
      lines.push(`**${data.title}**`);
      lines.push("");
      if (data.assumptions.length > 0) {
        lines.push("Assumptions:");
        data.assumptions.forEach((a) => lines.push(`• ${a}`));
        lines.push("");
      }
      if (data.notes.length > 0) {
        data.notes.forEach((n) => lines.push(`• ${n}`));
        lines.push("");
      }
      if (data.units) lines.push(`Units: ${data.units}`);
      if (data.abaqus_version) lines.push(`Abaqus version: ${data.abaqus_version}`);
      lines.push("");
      lines.push("Script is ready in the preview panel.");

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: lines.join("\n"),
        timestamp: new Date(),
        issues: issues?.filter((i) => !i.startsWith("INFO:")),
        analysisType: analysis_type,
        latencyMs: latency_ms,
      };

      setMessages((prev) => [...prev, assistantMsg]);
      onScriptGenerated(data.script, userPrompt);
      if (!subscribed) recordUsage();
    } catch (e) {
      console.error("Generation error:", e);
      const errorMsg = e instanceof Error ? e.message : "Unknown error";
      toast.error(errorMsg);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Failed to generate script: ${errorMsg}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* Paywall overlay */}
      {showPaywall && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl p-6 max-w-sm w-full space-y-4 shadow-lg">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 border border-primary/20 mx-auto">
              <Lock className="w-5 h-5 text-primary" />
            </div>
            <div className="text-center space-y-1">
              <h3 className="text-lg font-semibold text-foreground">Free limit reached</h3>
              <p className="text-sm text-muted-foreground">
                You've used all {freeLimit} free script generations.
                {!user
                  ? " Sign up to continue or choose a plan for unlimited access."
                  : " Choose a plan to continue generating scripts."}
              </p>
            </div>
            <div className="space-y-2">
              {!user ? (
                <>
                  <button
                    onClick={() => navigate("/auth")}
                    className="w-full bg-primary text-primary-foreground rounded-lg px-4 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
                  >
                    Sign up / Log in
                  </button>
                  <button
                    onClick={() => navigate("/plans")}
                    className="w-full bg-secondary text-secondary-foreground rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-secondary/80 transition-colors"
                  >
                    View Plans
                  </button>
                </>
              ) : (
                <button
                  onClick={() => navigate("/plans")}
                  className="w-full bg-primary text-primary-foreground rounded-lg px-4 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  Choose a Plan
                </button>
              )}
              <button
                onClick={() => setShowPaywall(false)}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-3">
            <div className="w-12 h-12 rounded-lg border border-primary/30 flex items-center justify-center glow-primary-sm">
              <span className="text-primary font-mono text-lg font-bold">Aq</span>
            </div>
            <p className="text-sm">Describe the Abaqus model you want to build</p>
            <p className="text-xs max-w-[280px] text-center">
              e.g. "Create a cantilever beam with steel material, fixed on the left, and a distributed load on top"
            </p>
            {!subscribed && (
              <p className="text-[10px] text-muted-foreground/60">
                {remaining} of {freeLimit} free generations remaining
              </p>
            )}
          </div>
        )}
        {/* ... keep existing code (message rendering, generating indicator) */}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`animate-slide-up ${msg.role === "user" ? "flex justify-end" : ""}`}
          >
            <div
              className={`max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-primary/15 border border-primary/20 text-foreground"
                  : "bg-secondary text-secondary-foreground"
              }`}
            >
              {msg.content.split("\n").map((line, i) => (
                <p key={i} className={i > 0 ? "mt-1" : ""}>
                  {line.startsWith("•") ? (
                    <span className="text-primary">{line}</span>
                  ) : line.startsWith("**") ? (
                    <strong>{line.replace(/\*\*/g, "")}</strong>
                  ) : (
                    line
                  )}
                </p>
              ))}
              {msg.issues && msg.issues.length > 0 && (
                <div className="mt-2 space-y-1">
                  {msg.issues.map((issue, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs">
                      {issue.startsWith("Missing") || issue.startsWith("No ") ? (
                        <AlertTriangle className="w-3 h-3 text-destructive mt-0.5 shrink-0" />
                      ) : (
                        <Info className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
                      )}
                      <span className="text-muted-foreground">{issue}</span>
                    </div>
                  ))}
                </div>
              )}
              {msg.analysisType && (
                <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-mono uppercase">
                    {msg.analysisType}
                  </span>
                  {msg.latencyMs && <span>{(msg.latencyMs / 1000).toFixed(1)}s</span>}
                </div>
              )}
            </div>
          </div>
        ))}
        {isGenerating && (
          <div className="flex items-center gap-2 text-primary text-sm animate-slide-up">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Generating Abaqus script...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border">
        {!subscribed && remaining > 0 && remaining <= 2 && (
          <p className="text-[10px] text-amber-400 mb-1.5 px-1">
            {remaining} free generation{remaining === 1 ? "" : "s"} remaining
          </p>
        )}
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Describe your model..."
            className="flex-1 bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 font-sans"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isGenerating}
            className="bg-primary text-primary-foreground rounded-md px-3 py-2 hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
