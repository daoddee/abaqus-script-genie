import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, Sparkles, ArrowRight, Copy, Check, Plus, MessageSquare, Trash2, Clock } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  final_prompt: string | null;
  created_at: string;
  updated_at: string;
}

interface PromptBuilderProps {
  onPromptReady: (prompt: string) => void;
}

const STARTER_TEMPLATES = [
  { label: "Beam under load", prompt: "I want to simulate a beam under load" },
  { label: "Contact between plates", prompt: "I need a contact analysis between two plates" },
  { label: "Pressure vessel", prompt: "I want to analyze a pressure vessel with internal pressure" },
  { label: "Plate with hole", prompt: "I want to model a plate with a central hole under tension" },
  { label: "Dynamic impact", prompt: "I need a dynamic impact simulation" },
  { label: "Bolted connection", prompt: "I want to simulate a bolted plate connection with friction" },
];

const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/prompt-builder`;

const PromptBuilder = ({ onPromptReady }: PromptBuilderProps) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [finalPrompt, setFinalPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Load conversations list
  const loadConversations = useCallback(async () => {
    if (!user) return;
    setLoadingHistory(true);
    try {
      const { data, error } = await supabase
        .from("prompt_conversations")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(20);

      if (error) throw error;

      setConversations(
        (data || []).map((d) => ({
          ...d,
          messages: (d.messages as unknown as Message[]) || [],
        }))
      );
    } catch (e) {
      console.error("Failed to load conversations:", e);
    } finally {
      setLoadingHistory(false);
    }
  }, [user]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const saveConversation = useCallback(
    async (msgs: Message[], prompt: string | null, convoId: string | null) => {
      if (!user || msgs.length === 0) return;

      const firstUserMsg = msgs.find((m) => m.role === "user");
      const title = firstUserMsg
        ? firstUserMsg.content.slice(0, 60) + (firstUserMsg.content.length > 60 ? "…" : "")
        : "New Conversation";

      try {
        if (convoId) {
          await supabase
            .from("prompt_conversations")
            .update({
              messages: JSON.parse(JSON.stringify(msgs)),
              final_prompt: prompt,
              title,
            })
            .eq("id", convoId)
            .eq("user_id", user.id);
        } else {
          const { data, error } = await supabase
            .from("prompt_conversations")
            .insert([{
              user_id: user.id,
              messages: JSON.parse(JSON.stringify(msgs)),
              final_prompt: prompt,
              title,
            }])
            .select("id")
            .single();

          if (!error && data) {
            setActiveConversationId(data.id);
          }
        }
        loadConversations();
      } catch (e) {
        console.error("Failed to save conversation:", e);
      }
    },
    [user, loadConversations]
  );

  const debouncedSave = useCallback(
    (msgs: Message[], prompt: string | null, convoId: string | null) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => saveConversation(msgs, prompt, convoId), 1000);
    },
    [saveConversation]
  );

  const extractFinalPrompt = (text: string): string | null => {
    const match = text.match(/```FINAL_PROMPT\n([\s\S]*?)```/);
    return match ? match[1].trim() : null;
  };

  const handleSend = async (overrideInput?: string) => {
    const text = overrideInput || input;
    if (!text.trim() || isLoading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text.trim(),
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

      const updatedMessages = [...newMessages, assistantMsg];
      setMessages(updatedMessages);

      const extracted = extractFinalPrompt(result.reply);
      if (extracted) {
        setFinalPrompt(extracted);
      }

      debouncedSave(updatedMessages, extracted || finalPrompt, activeConversationId);
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

  const handleNewConversation = () => {
    setMessages([]);
    setFinalPrompt(null);
    setActiveConversationId(null);
    setShowHistory(false);
  };

  const handleLoadConversation = (convo: Conversation) => {
    setMessages(convo.messages);
    setFinalPrompt(convo.final_prompt);
    setActiveConversationId(convo.id);
    setShowHistory(false);
  };

  const handleDeleteConversation = async (convoId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    try {
      await supabase
        .from("prompt_conversations")
        .delete()
        .eq("id", convoId)
        .eq("user_id", user.id);

      if (activeConversationId === convoId) {
        handleNewConversation();
      }
      loadConversations();
      toast.success("Conversation deleted");
    } catch (e) {
      toast.error("Failed to delete conversation");
    }
  };

  const handleStartFromTemplate = (prompt: string) => {
    handleNewConversation();
    setTimeout(() => handleSend(prompt), 50);
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  };

  // History panel overlay
  if (showHistory) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-medium text-foreground">Conversations</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleNewConversation}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
            >
              <Plus className="w-3 h-3" />
              New
            </button>
            <button
              onClick={() => setShowHistory(false)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Back
            </button>
          </div>
        </div>

        {/* Starter templates */}
        <div className="px-3 py-2 border-b border-border">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Start from template</p>
          <div className="grid grid-cols-2 gap-1.5">
            {STARTER_TEMPLATES.map((t) => (
              <button
                key={t.label}
                onClick={() => handleStartFromTemplate(t.prompt)}
                className="text-left px-2 py-1.5 rounded border border-border hover:border-primary/30 hover:bg-secondary/50 transition-all text-[11px] text-muted-foreground hover:text-foreground"
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Saved conversations */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {loadingHistory ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground space-y-2">
              <MessageSquare className="w-8 h-8 opacity-20" />
              <p className="text-xs">No saved conversations yet</p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {conversations.map((convo) => (
                <button
                  key={convo.id}
                  onClick={() => handleLoadConversation(convo)}
                  className={`w-full text-left px-3 py-2 rounded-md transition-colors group ${
                    activeConversationId === convo.id
                      ? "bg-primary/10 border border-primary/20"
                      : "hover:bg-muted border border-transparent"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{convo.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {formatTime(convo.updated_at)}
                        </span>
                        {convo.final_prompt && (
                          <span className="text-[10px] px-1 py-0.5 rounded bg-success/15 text-success border border-success/20">
                            Ready
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDeleteConversation(convo.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive transition-all"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Header with history toggle */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <button
          onClick={() => setShowHistory(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Clock className="w-3.5 h-3.5" />
          History
          {conversations.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{conversations.length}</span>
          )}
        </button>
        <button
          onClick={handleNewConversation}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Plus className="w-3 h-3" />
          New
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-3">
            <div className="w-12 h-12 rounded-lg border border-primary/30 flex items-center justify-center glow-primary-sm">
              <Sparkles className="w-6 h-6 text-primary" />
            </div>
            {/* #1 Identity Framing */}
            <p className="text-sm font-medium text-foreground">Operate Like a Senior Abaqus Engineer — From Day One</p>
            <p className="text-xs max-w-[280px] text-center">
              Describe your simulation intent. The AI will systematically define every parameter — geometry, materials, BCs, loads, mesh, and output — so nothing is left ambiguous.
            </p>
            {/* #11 Social proof */}
            <p className="text-[10px] text-muted-foreground/50 italic">
              Used in academic and consultancy workflows
            </p>

            {/* Quick start templates inline */}
            <div className="w-full max-w-[300px] space-y-1.5 pt-2">
              <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider text-center">Quick start</p>
              {STARTER_TEMPLATES.slice(0, 4).map((t) => (
                <button
                  key={t.label}
                  onClick={() => handleStartFromTemplate(t.prompt)}
                  className="w-full text-left px-3 py-2 rounded-md border border-border hover:border-primary/30 hover:bg-secondary/50 transition-all text-xs text-muted-foreground hover:text-foreground"
                >
                  {t.label}
                </button>
              ))}
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
            {/* #4 Authority bias */}
            <span>Analyzing simulation requirements...</span>
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
            placeholder="Describe your simulation intent..."
            className="flex-1 bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 font-sans"
          />
          <button
            onClick={() => handleSend()}
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
