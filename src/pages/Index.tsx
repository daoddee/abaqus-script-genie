import { useState, useRef } from "react";
import { PanelLeftClose, PanelLeftOpen, BookOpen, History, Terminal } from "lucide-react";
import ChatPanel from "../components/ChatPanel";
import ScriptPreview from "../components/ScriptPreview";
import TemplatePanel from "../components/TemplatePanel";
import HistorySidebar from "../components/HistorySidebar";

type SidebarTab = "templates" | "history";

const Index = () => {
  const [script, setScript] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("templates");
  const chatRef = useRef<{ setInput: (val: string) => void } | null>(null);

  const handleTemplateSelect = (prompt: string) => {
    // We'll use a simple approach: set the input via a callback
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
          {/* Sidebar header */}
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

          {/* Sidebar tabs */}
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

          {/* Sidebar content */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {sidebarTab === "templates" ? (
              <TemplatePanel onSelectTemplate={handleTemplateSelect} />
            ) : (
              <HistorySidebar />
            )}
          </div>

          {/* Sidebar footer */}
          <div className="p-3 border-t border-border">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Terminal className="w-3.5 h-3.5" />
              <span>Abaqus 2024 detected</span>
              <span className="ml-auto w-2 h-2 rounded-full bg-success animate-pulse-glow" />
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex min-w-0">
        {/* Chat panel */}
        <div className="w-[380px] border-r border-border flex flex-col shrink-0">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="text-muted-foreground hover:text-foreground transition-colors mr-1"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            )}
            <h2 className="text-sm font-semibold text-foreground">Prompt</h2>
            <span className="text-xs text-muted-foreground ml-auto font-mono">v0.1</span>
          </div>
          <ChatPanel onScriptGenerated={setScript} />
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
            <ScriptPreview script={script} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
