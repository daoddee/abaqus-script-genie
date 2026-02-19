import { useState } from "react";
import { Send, Loader2 } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface ChatPanelProps {
  onScriptGenerated: (script: string, prompt?: string) => void;
}

const DEMO_SCRIPTS: Record<string, string> = {
  cantilever: `# Abaqus Python Script - Cantilever Beam Analysis
from abaqus import *
from abaqusConstants import *
from caeModules import *

# Create Model
myModel = mdb.Model(name='CantileverBeam')

# Create Part - 2D Beam
mySketch = myModel.ConstrainedSketch(name='beamSketch', sheetSize=200.0)
mySketch.rectangle(point1=(0.0, 0.0), point2=(100.0, 10.0))
myPart = myModel.Part(name='Beam', dimensionality=TWO_D_PLANAR, type=DEFORMABLE_BODY)
myPart.BaseShell(sketch=mySketch)

# Define Material
myMaterial = myModel.Material(name='Steel')
myMaterial.Elastic(table=((210000.0, 0.3),))
myMaterial.Density(table=((7.85e-09,),))

# Create Section
myModel.HomogeneousSolidSection(name='BeamSection', material='Steel', thickness=1.0)

# Assign Section
region = myPart.Set(faces=myPart.faces, name='AllBeam')
myPart.SectionAssignment(region=region, sectionName='BeamSection')

# Assembly
myAssembly = myModel.rootAssembly
myInstance = myAssembly.Instance(name='BeamInstance', part=myPart, dependent=ON)

# Step
myModel.StaticStep(name='LoadStep', previous='Initial', nlgeom=OFF)

# Boundary Condition - Fixed left end
leftEdge = myInstance.edges.findAt(((0.0, 5.0, 0.0),))
leftRegion = myAssembly.Set(edges=leftEdge, name='FixedEnd')
myModel.DisplacementBC(name='Fixed', createStepName='LoadStep',
    region=leftRegion, u1=0.0, u2=0.0, ur3=0.0)

# Load - Pressure on top edge
topEdge = myInstance.edges.findAt(((50.0, 10.0, 0.0),))
topSurface = myAssembly.Surface(side1Edges=topEdge, name='TopSurface')
myModel.Pressure(name='TopLoad', createStepName='LoadStep',
    region=topSurface, magnitude=1.0)

# Mesh
myPart.seedPart(size=2.0)
myPart.generateMesh()

# Job
mdb.Job(name='CantileverJob', model='CantileverBeam', type=ANALYSIS)
print("Script generated successfully - Cantilever Beam model ready.")`,
};

const ChatPanel = ({ onScriptGenerated }: ChatPanelProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

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

    // Simulate AI response
    setTimeout(() => {
      const script = DEMO_SCRIPTS.cantilever;
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `I've generated a **Cantilever Beam Analysis** script for you. The model includes:\n\n• 2D planar beam (100×10 mm)\n• Steel material (E=210 GPa, ν=0.3)\n• Fixed left end boundary condition\n• Pressure load on top surface\n• Quad mesh with 2mm seed size\n\nThe script is ready in the preview panel. Review it before execution.`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      onScriptGenerated(script, userPrompt);
      setIsGenerating(false);
    }, 1500);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
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
            className={`animate-slide-up ${
              msg.role === "user" ? "flex justify-end" : ""
            }`}
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
