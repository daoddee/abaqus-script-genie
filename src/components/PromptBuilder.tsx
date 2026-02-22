import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Sparkles, ArrowRight, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface PromptBuilderProps {
  onPromptReady: (prompt: string) => void;
}

const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/prompt-builder`;

const PromptBuilder = ({ onPromptReady }: PromptBuilderProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [finalPrompt, setFinalPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const extractFinalPrompt = (text: string): string | null => {
    const match = text.match(/```FINAL_PROMPT\n([\s\S]*?)```/);
    return match ? match[1].trim() : null;
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      const apiMessages = newMessages.map(({ role, content }) => ({ role, content }));

      const resp = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: apiMessages }),
      });

      const result = await resp.json();

      if (!result.ok) {
        toast.error(result.error || "Failed to get response");
        return;
      }

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: result.reply,
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // Check if final prompt was generated
      const extracted = extractFinalPrompt(result.reply);
      if (extracted) {
        setFinalPrompt(extracted);
      }
    } catch (e) {
      console.error("Prompt builder error:", e);
      toast.error("Failed to connect to AI assistant");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUsePrompt = () => {
    if (finalPrompt) {
      onPromptReady(finalPrompt);
      toast.success("Prompt sent to Script Generator!");
    }
  };

  const handleCopy = async () => {
    if (!finalPrompt) return;
    await navigator.clipboard.writeText(finalPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-3">
            <div className="w-12 h-12 rounded-lg border border-primary/30 flex items-center justify-center glow-primary-sm">
              <Sparkles className="w-6 h-6 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">Prompt Builder</p>
            <p className="text-xs max-w-[280px] text-center">
              Tell me what you want to simulate and I'll help you build a detailed, complete prompt for the script generator.
            </p>
            <div className="space-y-1.5 text-[11px] text-muted-foreground/70 max-w-[260px]">
              <p>Try something like:</p>
              <p className="italic">"I want to simulate a beam under load"</p>
              <p className="italic">"I need a contact analysis for two plates"</p>
              <p className="italic">"Pressure vessel with internal pressure"</p>
            </div>
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
              {msg.role === "assistant" ? (
                <div className="prose prose-sm prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_strong]:text-foreground [&_code]:text-primary [&_code]:bg-primary/10 [&_code]:px-1 [&_code]:rounded text-muted-foreground">
                  <ReactMarkdown>{msg.content.replace(/```FINAL_PROMPT\n[\s\S]*?```/, "").trim()}</ReactMarkdown>
                </div>
              ) : (
                <p>{msg.content}</p>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex items-center gap-2 text-primary text-sm animate-slide-up">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Thinking...</span>
          </div>
        )}
      </div>

      {/* Final prompt card */}
      {finalPrompt && (
        <div className="mx-3 mb-2 p-3 rounded-lg bg-success/10 border border-success/20 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-success" />
            <span className="text-xs font-medium text-success">Prompt Ready</span>
          </div>
          <p className="text-[11px] text-muted-foreground line-clamp-3">{finalPrompt}</p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleUsePrompt}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              <ArrowRight className="w-3 h-3" />
              Use in Script Generator
            </button>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-border">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Describe what you want to simulate..."
            className="flex-1 bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 font-sans"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="bg-primary text-primary-foreground rounded-md px-3 py-2 hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default PromptBuilder;
