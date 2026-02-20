import { useState, useRef, useEffect } from "react";
import { Send, Loader2, AlertTriangle, Info } from "lucide-react";
import { toast } from "sonner";

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isGenerating]);

  const handleSend = async () => {
    if (!input.trim() || isGenerating) return;

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
    <div className="flex flex-col h-full">
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
          </div>
        )}
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
              {/* Warnings/issues */}
              {msg.issues && msg.issues.length > 0 && (
                <div className="mt-2 space-y-1">
                  {msg.issues.map((issue, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-1.5 text-xs"
                    >
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
              {/* Metadata */}
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
