import { Clock, MessageSquare, FileCode2 } from "lucide-react";

interface HistoryItem {
  id: string;
  title: string;
  timestamp: string;
  scriptLines: number;
}

const demoHistory: HistoryItem[] = [
  { id: "1", title: "Cantilever beam analysis", timestamp: "2 min ago", scriptLines: 45 },
  { id: "2", title: "Plate with hole - mesh refinement", timestamp: "1 hour ago", scriptLines: 62 },
  { id: "3", title: "Contact pair setup", timestamp: "Yesterday", scriptLines: 88 },
];

interface HistorySidebarProps {
  onSelect?: (id: string) => void;
}

const HistorySidebar = ({ onSelect }: HistorySidebarProps) => {
  return (
    <div className="p-3 space-y-1">
      <div className="flex items-center gap-2 px-1 mb-3">
        <Clock className="w-3.5 h-3.5 text-muted-foreground" />
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          History
        </h3>
      </div>
      {demoHistory.map((item) => (
        <button
          key={item.id}
          onClick={() => onSelect?.(item.id)}
          className="w-full text-left p-2 rounded-md hover:bg-secondary/50 transition-colors group"
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
            <span className="text-sm text-foreground truncate">{item.title}</span>
          </div>
          <div className="flex items-center gap-2 mt-1 ml-5.5">
            <span className="text-xs text-muted-foreground">{item.timestamp}</span>
            <span className="text-xs text-muted-foreground/40">·</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <FileCode2 className="w-3 h-3" />
              {item.scriptLines} lines
            </span>
          </div>
        </button>
      ))}
    </div>
  );
};

export default HistorySidebar;
