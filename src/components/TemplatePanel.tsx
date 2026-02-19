import { Box, Cylinder, CircleDot, Layers, Zap, Settings2 } from "lucide-react";

interface Template {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  prompt: string;
}

const templates: Template[] = [
  {
    id: "cantilever",
    title: "Cantilever Beam",
    description: "2D beam, fixed end, distributed load",
    icon: <Box className="w-4 h-4" />,
    prompt: "Create a 2D cantilever beam (100x10mm) with steel material, fixed on the left end, and a uniform pressure load on the top surface.",
  },
  {
    id: "plate-hole",
    title: "Plate with Hole",
    description: "Stress concentration analysis",
    icon: <CircleDot className="w-4 h-4" />,
    prompt: "Create a plate with a central circular hole for stress concentration analysis. Apply tensile load on one end.",
  },
  {
    id: "cylinder",
    title: "Pressure Vessel",
    description: "Internal pressure on cylinder",
    icon: <Cylinder className="w-4 h-4" />,
    prompt: "Create an axisymmetric pressure vessel with internal pressure loading and appropriate boundary conditions.",
  },
  {
    id: "contact",
    title: "Contact Analysis",
    description: "Two bodies with surface contact",
    icon: <Layers className="w-4 h-4" />,
    prompt: "Create a contact analysis between a rigid indenter and a deformable block with friction.",
  },
  {
    id: "dynamic",
    title: "Dynamic Impact",
    description: "Explicit dynamic step",
    icon: <Zap className="w-4 h-4" />,
    prompt: "Create a dynamic explicit analysis of a projectile impacting a plate with appropriate mass scaling.",
  },
  {
    id: "parametric",
    title: "Parametric Study",
    description: "Sweep geometry/material params",
    icon: <Settings2 className="w-4 h-4" />,
    prompt: "Create a parametric script that sweeps beam thickness from 5mm to 20mm in 4 steps, running each as a separate job.",
  },
];

interface TemplatePanelProps {
  onSelectTemplate: (prompt: string) => void;
}

const TemplatePanel = ({ onSelectTemplate }: TemplatePanelProps) => {
  return (
    <div className="p-3 space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-3">
        Quick Start Templates
      </h3>
      {templates.map((t) => (
        <button
          key={t.id}
          onClick={() => onSelectTemplate(t.prompt)}
          className="w-full text-left p-2.5 rounded-md border border-border hover:border-primary/30 hover:bg-secondary/50 transition-all group"
        >
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 text-muted-foreground group-hover:text-primary transition-colors">
              {t.icon}
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{t.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
};

export default TemplatePanel;
