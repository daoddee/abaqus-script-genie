import { useState, useRef, useCallback } from "react";
import { PanelLeftClose, PanelLeftOpen, BookOpen, History, Terminal, Send, Bug, CreditCard } from "lucide-react";
import { useNavigate } from "react-router-dom";
import ChatPanel from "../components/ChatPanel";
import ScriptPreview from "../components/ScriptPreview";
import type { ArchivedScript } from "../components/ScriptPreview";
import TemplatePanel from "../components/TemplatePanel";
import HistorySidebar from "../components/HistorySidebar";
import DebugPanel from "../components/DebugPanel";

type SidebarTab = "templates" | "history";
type MiddleTab = "prompt" | "debug";
type RuntimeMode = "py3" | "py27";

const Index = () => {
  const navigate = useNavigate();
  const [script, setScript] = useState("");
  const [archivedScripts, setArchivedScripts] = useState<ArchivedScript[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("templates");
  const [middleTab, setMiddleTab] = useState<MiddleTab>("prompt");
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("py3");
  const scriptNameRef = useRef("abaqus_script.py");
  const activePromptRef = useRef<string | null>(null);
  const chatRef = useRef<{ setInput: (val: string) => void } | null>(null);

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
  }, [script]);

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
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Left Sidebar */}
      {sidebarOpen && (
        <div className="w-64 border-r border-border flex flex-col bg-card shrink-0">
          <div className="flex items-center justify-between px-3 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded border border-primary/30 flex items-center justify-center glow-primary-sm">
                <span className="text-primary font-mono text-xs font-bold">Aq</span>
              </div>
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
            <button
              onClick={() => navigate("/plans")}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <CreditCard className="w-3.5 h-3.5" />
              Plans & Billing
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
            {/* Tab switcher */}
            <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
              <button
                onClick={() => setMiddleTab("prompt")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors ${
                  middleTab === "prompt"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Send className="w-3 h-3" />
                Prompt
              </button>
              <button
                onClick={() => setMiddleTab("debug")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors ${
                  middleTab === "debug"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Bug className="w-3 h-3" />
                Debug
              </button>
            </div>
            <span className="text-xs text-muted-foreground ml-auto font-mono">v0.1</span>
          </div>
          {middleTab === "prompt" ? (
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
