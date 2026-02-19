import { useState } from "react";
import { Copy, Download, Check, Play, FileCode2, FileCode, ChevronRight, Bug } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./ui/collapsible";
import DebugPanel from "./DebugPanel";
// @ts-ignore
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
// @ts-ignore
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

export interface ArchivedScript {
  name: string;
  content: string;
}

type PreviewTab = "code" | "debug";

interface ScriptPreviewProps {
  script: string;
  archivedScripts?: ArchivedScript[];
  onScriptUpdate?: (script: string) => void;
}

const ScriptPreview = ({ script, archivedScripts = [], onScriptUpdate }: ScriptPreviewProps) => {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<PreviewTab>("code");

  const handleCopy = async () => {
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([script], { type: "text/x-python" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "abaqus_script.py";
    a.click();
    URL.revokeObjectURL(url);
  };

  const lineCount = script ? script.split("\n").length : 0;

  if (!script) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-4">
        <FileCode2 className="w-16 h-16 opacity-20" />
        <div className="text-center space-y-1">
          <p className="text-sm font-medium">No script generated yet</p>
          <p className="text-xs">Use the chat to describe your Abaqus model</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Archived scripts */}
      {archivedScripts.length > 0 && (
        <div className="px-3 pt-3 space-y-1.5">
          {archivedScripts.map((file, i) => (
            <Collapsible key={i}>
              <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-muted/60 border border-border hover:bg-muted transition-colors group text-left">
                <FileCode className="w-4 h-4 text-primary shrink-0" />
                <span className="text-xs font-mono text-foreground truncate flex-1">{file.name}</span>
                <span className="text-[10px] text-muted-foreground mr-1">{file.content.split("\n").length} lines</span>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-1 max-h-48 overflow-auto rounded-md border border-border scrollbar-thin">
                  <SyntaxHighlighter
                    language="python"
                    style={vscDarkPlus}
                    showLineNumbers
                    customStyle={{
                      margin: 0,
                      padding: "8px",
                      background: "transparent",
                      fontSize: "11px",
                      lineHeight: "1.5",
                    }}
                    lineNumberStyle={{
                      color: "hsl(215 15% 35%)",
                      paddingRight: "12px",
                      minWidth: "32px",
                    }}
                  >
                    {file.content}
                  </SyntaxHighlighter>
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      )}

      {/* Tab switcher */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab("code")}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors ${
            activeTab === "code"
              ? "text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileCode2 className="w-3.5 h-3.5" />
          Code
        </button>
        <button
          onClick={() => setActiveTab("debug")}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors ${
            activeTab === "debug"
              ? "text-destructive border-b-2 border-destructive"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Bug className="w-3.5 h-3.5" />
          Debug
        </button>
      </div>

      {activeTab === "code" ? (
        <>
          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <div className="flex items-center gap-2">
              <FileCode2 className="w-4 h-4 text-primary" />
              <span className="text-xs font-mono text-muted-foreground">abaqus_script.py</span>
              <span className="text-xs text-muted-foreground/60">· {lineCount} lines</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Export .py
              </button>
              <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs bg-primary/15 text-primary border border-primary/20 hover:bg-primary/25 transition-colors ml-1">
                <Play className="w-3.5 h-3.5" />
                Run
              </button>
            </div>
          </div>

          {/* Code */}
          <div className="flex-1 overflow-auto scrollbar-thin">
            <SyntaxHighlighter
              language="python"
              style={vscDarkPlus}
              showLineNumbers
              customStyle={{
                margin: 0,
                padding: "16px",
                background: "transparent",
                fontSize: "13px",
                lineHeight: "1.6",
              }}
              lineNumberStyle={{
                color: "hsl(215 15% 35%)",
                paddingRight: "16px",
                minWidth: "40px",
              }}
            >
              {script}
            </SyntaxHighlighter>
          </div>
        </>
      ) : (
        <DebugPanel
          script={script}
          onApplyFix={(fixed) => onScriptUpdate?.(fixed)}
        />
      )}
    </div>
  );
};

export default ScriptPreview;
