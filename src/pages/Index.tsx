import { useState, useRef, useCallback } from "react";
import logo from "@/assets/logo.png";
import { PanelLeftClose, PanelLeftOpen, BookOpen, History, Terminal, Send, Bug, CreditCard, Code, MessageSquare, LogOut, User, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import ChatPanel from "../components/ChatPanel";
import ScriptPreview from "../components/ScriptPreview";
import type { ArchivedScript } from "../components/ScriptPreview";
import TemplatePanel from "../components/TemplatePanel";
import HistorySidebar from "../components/HistorySidebar";
import DebugPanel from "../components/DebugPanel";
import PromptBuilder from "../components/PromptBuilder";

type SidebarTab = "templates" | "history";
type MiddleTab = "builder" | "prompt" | "debug";
type RuntimeMode = "py3" | "py27";
type MobileView = "builder" | "chat" | "script";

const Index = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [script, setScript] = useState("");
  const [archivedScripts, setArchivedScripts] = useState<ArchivedScript[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("templates");
  const [middleTab, setMiddleTab] = useState<MiddleTab>("builder");
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("py3");
  const [mobileView, setMobileView] = useState<MobileView>("builder");
  const scriptNameRef = useRef("abaqus_script.py");
  const activePromptRef = useRef<string | null>(null);
  const chatRef = useRef<{ setInput: (val: string) => void } | null>(null);
  const chatInputRef = useRef<string | null>(null);

  const handlePromptReady = (prompt: string) => {
    chatInputRef.current = prompt;
    setMiddleTab("prompt");
    // Set the chat input after switching tabs
    setTimeout(() => {
      const inputEl = document.querySelector<HTMLInputElement>(
        'input[placeholder="Describe your model..."]'
      );
      if (inputEl) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        )?.set;
        nativeInputValueSetter?.call(inputEl, prompt);
        inputEl.dispatchEvent(new Event("input", { bubbles: true }));
        inputEl.focus();
      }
    }, 100);
  };

  // ... keep existing code (generateScriptName, handleScriptGenerated, handleTemplateSelect)
  const generateScriptName = (prompt: string): string => {
    const words = prompt.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
    const meaningful = words.filter(w => !["a", "the", "an", "with", "and", "or", "create", "make", "build", "generate", "model", "please"].includes(w));
    const name = meaningful.slice(0, 3).join("_") || "script";
    return `${name}.py`;
  };

  const handleScriptGenerated = useCallback((newScript: string, prompt?: string) => {
    if (prompt && prompt !== activePromptRef.current) {
      if (script && activePromptRef.current) {
        const archiveName = scriptNameRef.current;
        const archiveContent = script;
        setArchivedScripts(prev => [...prev, { name: archiveName, content: archiveContent }]);
      }
      scriptNameRef.current = generateScriptName(prompt);
      activePromptRef.current = prompt;
    }
    setScript(newScript);
    // Auto-switch to script view on mobile when generated
    if (isMobile) setMobileView("script");
  }, [script, isMobile]);

  const handleTemplateSelect = (prompt: string) => {
    const inputEl = document.querySelector<HTMLInputElement>(
      'input[placeholder="Describe your model..."]'
    );
    if (inputEl) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      nativeInputValueSetter?.call(inputEl, prompt);
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      inputEl.focus();
    }
    if (isMobile) {
      setSidebarOpen(false);
      setMobileView("chat");
    }
  };

  // ── Mobile Layout ──
  if (isMobile) {
    return (
      <div className="flex flex-col h-screen bg-background overflow-hidden">
        {/* Mobile header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-card shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
            </button>
            <img src={logo} alt="Abaqus AI" className="w-6 h-6 rounded" />
            <span className="text-sm font-semibold text-foreground">Abaqus AI</span>
          </div>
          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
            runtimeMode === "py3"
              ? "bg-primary/15 text-primary border border-primary/20"
              : "bg-amber-500/15 text-amber-400 border border-amber-500/20"
          }`}>
            {runtimeMode === "py3" ? "Py3" : "Py2.7"}
          </span>
        </div>

        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div className="absolute inset-0 z-50 flex">
            <div className="w-72 bg-card border-r border-border flex flex-col h-full shadow-xl">
              <div className="flex items-center justify-between px-3 py-3 border-b border-border">
                <span className="text-sm font-semibold text-foreground">Menu</span>
                <button onClick={() => setSidebarOpen(false)} className="text-muted-foreground hover:text-foreground">
                  <PanelLeftClose className="w-4 h-4" />
                </button>
              </div>
              <div className="flex border-b border-border">
                <button
                  onClick={() => setSidebarTab("templates")}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${
                    sidebarTab === "templates" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5" /> Templates
                </button>
                <button
                  onClick={() => setSidebarTab("history")}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${
                    sidebarTab === "history" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"
                  }`}
                >
                  <History className="w-3.5 h-3.5" /> History
                </button>
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-thin">
                {sidebarTab === "templates" ? (
                  <TemplatePanel onSelectTemplate={handleTemplateSelect} />
                ) : (
                  <HistorySidebar />
                )}
              </div>
              <div className="p-3 border-t border-border space-y-2">
                {/* Account details */}
                {user && (
                  <div className="flex items-center gap-2 px-2 py-1.5">
                    <Avatar className="w-6 h-6">
                      <AvatarImage src={user.user_metadata?.avatar_url} />
                      <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                        {(user.user_metadata?.full_name || user.email || "U").charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{user.user_metadata?.full_name || "User"}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
                    </div>
                  </div>
                )}
                <button
                  onClick={() => navigate("/plans")}
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <CreditCard className="w-3.5 h-3.5" /> Plans & Billing
                </button>
                <button
                  onClick={signOut}
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" /> Log out
                </button>
                <button
                  onClick={() => setRuntimeMode(runtimeMode === "py3" ? "py27" : "py3")}
                  className="flex items-center justify-between w-full px-2 py-1.5 rounded-md bg-muted/60 border border-border hover:bg-muted transition-colors"
                >
                  <span className="text-xs text-muted-foreground">Runtime</span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                    runtimeMode === "py3"
                      ? "bg-primary/15 text-primary border border-primary/20"
                      : "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                  }`}>
                    {runtimeMode === "py3" ? "Python 3.x" : "Python 2.7"}
                  </span>
                </button>
              </div>
            </div>
            <div className="flex-1 bg-black/40" onClick={() => setSidebarOpen(false)} />
          </div>
        )}

        {/* Mobile content area */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {mobileView === "builder" ? (
            <PromptBuilder onPromptReady={(prompt) => {
              handlePromptReady(prompt);
              setMobileView("chat");
            }} />
          ) : mobileView === "chat" ? (
            <ChatPanel onScriptGenerated={handleScriptGenerated} runtimeMode={runtimeMode} />
          ) : (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex items-center px-4 py-2 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground">Script Preview</h2>
                {script && (
                  <span className="ml-2 px-1.5 py-0.5 text-[10px] font-mono rounded bg-success/15 text-success border border-success/20">
                    READY
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-hidden">
                <ScriptPreview script={script} archivedScripts={archivedScripts} onScriptUpdate={setScript} />
              </div>
            </div>
          )}
        </div>

        {/* Mobile bottom tab bar */}
        <div className="flex border-t border-border bg-card shrink-0">
          <button
            onClick={() => setMobileView("builder")}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${
              mobileView === "builder" ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <Sparkles className="w-5 h-5" />
            Builder
          </button>
          <button
            onClick={() => setMobileView("chat")}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${
              mobileView === "chat" ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <Send className="w-5 h-5" />
            Generate
          </button>
          <button
            onClick={() => setMobileView("script")}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${
              mobileView === "script" ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <Code className="w-5 h-5" />
            Script
            {script && (
              <span className="w-1.5 h-1.5 rounded-full bg-success absolute -mt-1 ml-4" />
            )}
          </button>
        </div>
      </div>
    );
  }

  // ── Desktop Layout ──
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Left Sidebar */}
      {sidebarOpen && (
        <div className="w-64 border-r border-border flex flex-col bg-card shrink-0">
          <div className="flex items-center justify-between px-3 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <img src={logo} alt="Abaqus AI" className="w-7 h-7 rounded" />
              <span className="text-sm font-semibold text-foreground">Abaqus AI</span>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>

          <div className="flex border-b border-border">
            <button
              onClick={() => setSidebarTab("templates")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${
                sidebarTab === "templates"
                  ? "text-primary border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              Templates
            </button>
            <button
              onClick={() => setSidebarTab("history")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${
                sidebarTab === "history"
                  ? "text-primary border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <History className="w-3.5 h-3.5" />
              History
            </button>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {sidebarTab === "templates" ? (
              <TemplatePanel onSelectTemplate={handleTemplateSelect} />
            ) : (
              <HistorySidebar />
            )}
          </div>

          <div className="p-3 border-t border-border space-y-2">
            {/* Account details */}
            {user && (
              <div className="flex items-center gap-2 px-2 py-1.5">
                <Avatar className="w-6 h-6">
                  <AvatarImage src={user.user_metadata?.avatar_url} />
                  <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                    {(user.user_metadata?.full_name || user.email || "U").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{user.user_metadata?.full_name || "User"}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
                </div>
              </div>
            )}
            <button
              onClick={() => navigate("/plans")}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <CreditCard className="w-3.5 h-3.5" />
              Plans & Billing
            </button>
            <button
              onClick={signOut}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Log out
            </button>
            <button
              onClick={() => setRuntimeMode(runtimeMode === "py3" ? "py27" : "py3")}
              className="flex items-center justify-between w-full px-2 py-1.5 rounded-md bg-muted/60 border border-border hover:bg-muted transition-colors"
            >
              <span className="text-xs text-muted-foreground">Runtime</span>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                runtimeMode === "py3"
                  ? "bg-primary/15 text-primary border border-primary/20"
                  : "bg-amber-500/15 text-amber-400 border border-amber-500/20"
              }`}>
                {runtimeMode === "py3" ? "Python 3.x" : "Python 2.7"}
              </span>
            </button>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Terminal className="w-3.5 h-3.5" />
              <span>Abaqus {runtimeMode === "py3" ? "2020+" : "≤2019"} detected</span>
              <span className="ml-auto w-2 h-2 rounded-full bg-success animate-pulse-glow" />
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex min-w-0">
        {/* Middle panel: Prompt / Debug tabs */}
        <div className="w-[380px] border-r border-border flex flex-col shrink-0 min-h-0 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="text-muted-foreground hover:text-foreground transition-colors mr-1"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            )}
            <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
              <button
                onClick={() => setMiddleTab("builder")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  middleTab === "builder"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Sparkles className="w-3 h-3" />
                <span className="hidden lg:inline">1.</span> Builder
              </button>
              <button
                onClick={() => setMiddleTab("prompt")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  middleTab === "prompt"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Send className="w-3 h-3" />
                <span className="hidden lg:inline">2.</span> Generate
              </button>
              <button
                onClick={() => setMiddleTab("debug")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  middleTab === "debug"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Bug className="w-3 h-3" />
                <span className="hidden lg:inline">3.</span> Debug
              </button>
            </div>
            <span className="text-xs text-muted-foreground ml-auto font-mono">v0.2</span>
          </div>
          {middleTab === "builder" ? (
            <PromptBuilder onPromptReady={handlePromptReady} />
          ) : middleTab === "prompt" ? (
            <ChatPanel onScriptGenerated={handleScriptGenerated} runtimeMode={runtimeMode} />
          ) : (
            <DebugPanel script={script} onApplyFix={setScript} />
          )}
        </div>

        {/* Script preview */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Script Preview</h2>
            {script && (
              <span className="ml-2 px-1.5 py-0.5 text-[10px] font-mono rounded bg-success/15 text-success border border-success/20">
                READY
              </span>
            )}
          </div>
          <div className="flex-1 overflow-hidden">
            <ScriptPreview script={script} archivedScripts={archivedScripts} onScriptUpdate={setScript} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
