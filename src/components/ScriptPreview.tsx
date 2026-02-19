import { useState } from "react";
import { Copy, Download, Check, Play, FileCode2 } from "lucide-react";
// @ts-ignore
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
// @ts-ignore
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

interface ScriptPreviewProps {
  script: string;
}

const ScriptPreview = ({ script }: ScriptPreviewProps) => {
  const [copied, setCopied] = useState(false);

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
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <FileCode2 className="w-4 h-4 text-primary" />
          <span className="text-xs font-mono text-muted-foreground">
            abaqus_script.py
          </span>
          <span className="text-xs text-muted-foreground/60">
            · {lineCount} lines
          </span>
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
    </div>
  );
};

export default ScriptPreview;
