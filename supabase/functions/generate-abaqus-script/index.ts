import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ═══════════════════════════════════════════════════════════════════
// ANALYSIS TYPE DETECTION
// ═══════════════════════════════════════════════════════════════════

const ANALYSIS_PATTERNS: Record<string, RegExp[]> = {
  static: [/static/i, /stress/i, /deflect/i, /cantilever/i, /beam/i, /truss/i, /plate/i, /load/i],
  modal: [/modal/i, /eigen/i, /natural\s*frequen/i, /vibrat/i, /mode\s*shape/i],
  buckling: [/buckl/i, /stability/i, /critical\s*load/i, /euler/i],
  contact: [/contact/i, /friction/i, /interac/i, /press\s*fit/i, /hertz/i],
  thermal: [/thermal/i, /heat/i, /temperature/i, /conduction/i, /convect/i],
  dynamic: [/dynamic/i, /impact/i, /explicit/i, /crash/i, /blast/i],
  fatigue: [/fatigue/i, /cycl/i, /endurance/i, /s-n\s*curve/i],
};

function detectAnalysisType(prompt: string): string {
  const scores: Record<string, number> = {};
  for (const [type, patterns] of Object.entries(ANALYSIS_PATTERNS)) {
    scores[type] = patterns.filter((p) => p.test(prompt)).length;
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : "static";
}

function detectMissingRequirements(prompt: string, analysisType: string): string[] {
  const warnings: string[] = [];
  const lower = prompt.toLowerCase();
  if (!(/material|steel|aluminum|aluminium|concrete|composite|elastic|plastic/i.test(lower)))
    warnings.push("No material specified — defaulting to Steel (E=210 GPa, ν=0.3).");
  if (!(/boundary|fixed|clamp|pin|support|constrain|encastre/i.test(lower)))
    warnings.push("No boundary conditions described — script may need manual BC definition.");
  if (!(/load|force|pressure|moment|torque|gravity|weight|distributed/i.test(lower)))
    warnings.push("No loads described — script may need manual load definition.");
  if (!(/mesh|element|seed|size|quad|hex|tet|tri/i.test(lower)))
    warnings.push("No mesh preferences specified — using default mesh seeding.");
  if (analysisType === "contact" && !(/master|slave|surface|pair/i.test(lower)))
    warnings.push("Contact analysis detected but no surface pairs described.");
  if (analysisType === "thermal" && !(/conductiv|specific\s*heat|emissiv/i.test(lower)))
    warnings.push("Thermal analysis detected — ensure thermal material properties are intended.");
  if (analysisType === "modal" && !(/density|mass/i.test(lower)))
    warnings.push("Modal analysis requires material density — ensure it is specified.");
  if (analysisType === "dynamic" && !(/density|mass|damp/i.test(lower)))
    warnings.push("Dynamic analysis needs density and possibly damping.");
  return warnings;
}

// ═══════════════════════════════════════════════════════════════════
// TEMPLATES
// ═══════════════════════════════════════════════════════════════════

const TEMPLATES: Record<string, string> = {
  cantilever: `# Template: Cantilever Beam
# Part: Rectangular 2D beam (L×H)
# Material: User-specified or Steel
# BC: Fixed left end (encastre)
# Load: User-specified or distributed top load
# Mesh: Quad elements, user seed size or 2.0`,
  plate_with_hole: `# Template: Plate with Central Hole
# Part: Rectangular plate with circular hole (2D or 3D)
# Material: User-specified or Aluminum
# BC: Fixed one edge
# Load: Tension on opposite edge
# Mesh: Structured quad with refinement around hole`,
  modal: `# Template: Modal Analysis
# Part: User geometry
# Material: User-specified (density required)
# Step: Frequency extraction (Lanczos solver)
# Output: Eigenvalues and mode shapes`,
  buckling: `# Template: Linear Buckling Analysis
# Part: Column or plate geometry
# Material: User-specified
# Step: Buckle step with eigenvalue extraction
# BC: User-specified end conditions
# Load: Compressive load`,
  contact: `# Template: Contact Analysis
# Parts: Two bodies
# Interaction: Surface-to-surface contact
# Properties: Hard contact normal, friction tangential
# Step: Static, general with nonlinear geometry
# Mesh: Fine mesh at contact region`,
};

// ═══════════════════════════════════════════════════════════════════
// BLOCKLIST & LINT
// ═══════════════════════════════════════════════════════════════════

const BLOCKLIST = [
  /\bsubprocess\b/,
  /\bos\.remove\b/,
  /\bos\.unlink\b/,
  /\bos\.rmdir\b/,
  /\bos\.system\b/,
  /\bshutil\.rmtree\b/,
  /\bshutil\.move\b/,
  /\bsocket\b/,
  /\brequests\b/,
  /\burllib\b/,
  /\bhttplib\b/,
  /\bhttp\.client\b/,
  /\beval\s*\(/,
  /\bexec\s*\(/,
  /\b__import__\b/,
  /\bcompile\s*\(/,
  /\bopen\s*\([^)]*['"][wa]/,
  /\bimport\s+ctypes\b/,
  /\bimport\s+sys\b.*\bsys\.exit\b/,
];

const REQUIRED_IMPORTS = [
  /from\s+abaqus\s+import\s+\*/,
  /from\s+abaqusConstants\s+import\s+\*/,
];

const STRUCTURE_CHECKS: Record<string, RegExp> = {
  model: /mdb\.Model\s*\(/,
  part: /\.Part\s*\(/,
  material: /\.Material\s*\(/,
  section: /Section\s*\(/,
  assembly: /rootAssembly/,
  step: /Step\s*\(/,
  job: /Job\s*\(/,
};

// ── Naming convention patterns (deterministic naming standard) ──
const NAMING_CONVENTIONS: Record<string, RegExp> = {
  parts: /['"]P_[A-Z0-9_]+['"]/,
  sets: /['"]SET_[A-Z0-9_]+['"]/,
  surfaces: /['"]SURF_[A-Z0-9_]+['"]/,
  steps: /['"]STEP_[A-Z0-9_]+['"]/,
  bcs: /['"]BC_[A-Z0-9_]+['"]/,
  loads: /['"]LOAD_[A-Z0-9_]+['"]/,
  jobs: /['"]JOB_[A-Z0-9_]+['"]/,
};

// ── Build order enforcement ──
const BUILD_ORDER_MARKERS = [
  { phase: "A1_model", pattern: /mdb\.Model\s*\(/, label: "Model creation" },
  { phase: "A2_material", pattern: /\.Material\s*\(/, label: "Material definition" },
  { phase: "A3_part", pattern: /\.Part\s*\(/, label: "Part creation" },
  { phase: "A4_section_assign", pattern: /\.SectionAssignment\s*\(/, label: "Section assignment" },
  { phase: "A5_assembly", pattern: /rootAssembly/, label: "Assembly" },
  { phase: "B1_sets", pattern: /\.Set\s*\(/, label: "Set creation" },
  { phase: "B2_surfaces", pattern: /\.Surface\s*\(/, label: "Surface creation" },
  { phase: "C1_step", pattern: /Step\s*\(/, label: "Step creation" },
  { phase: "C2_bc", pattern: /BoundaryCondition|DisplacementBC|EncastreBC|\.boundaryConditions/, label: "BC application" },
  { phase: "C3_load", pattern: /\.ConcentratedForce|\.Pressure|\.SurfaceTraction|\.Gravity|\.loads/, label: "Load application" },
  { phase: "D1_mesh", pattern: /\.seedPart|\.generateMesh|\.setElementType/, label: "Meshing" },
  { phase: "E1_job", pattern: /\.Job\s*\(/, label: "Job creation" },
];

function checkBuildOrder(script: string): string[] {
  const issues: string[] = [];
  const positions: { phase: string; pos: number; label: string }[] = [];

  for (const marker of BUILD_ORDER_MARKERS) {
    const match = script.match(marker.pattern);
    if (match && match.index !== undefined) {
      positions.push({ phase: marker.phase, pos: match.index, label: marker.label });
    }
  }

  // Check that phases appear in order
  for (let i = 1; i < positions.length; i++) {
    if (positions[i].pos < positions[i - 1].pos) {
      issues.push(
        `BUILD ORDER: "${positions[i].label}" appears before "${positions[i - 1].label}" — this will likely cause runtime errors.`
      );
    }
  }

  return issues;
}

// ── Selection strategy analysis ──
function checkSelectionStrategy(script: string): string[] {
  const issues: string[] = [];

  // Count findAt usages
  const findAtCount = (script.match(/findAt\s*\(/g) || []).length;
  const bboxCount = (script.match(/getByBoundingBox\s*\(/g) || []).length;
  const indexAccessCount = (script.match(/\.(faces|edges|cells|vertices)\[\d+\]/g) || []).length;

  if (indexAccessCount > 0) {
    issues.push(
      `SELECTION: ${indexAccessCount} index-based selections (e.g. faces[0]) detected — these break when geometry changes. Use sets, getByBoundingBox, or findAt instead.`
    );
  }

  if (findAtCount > 3 && bboxCount === 0) {
    issues.push(
      `SELECTION: ${findAtCount} findAt() calls with no getByBoundingBox() — consider bounding-box selection for robustness.`
    );
  }

  // Check for .keys() ordering on referencePoints (fragile)
  if (/referencePoints\.keys\s*\(\s*\)\s*\[/.test(script)) {
    issues.push(
      `SELECTION: Using referencePoints.keys()[index] — key ordering is unstable. Store the feature .id directly instead.`
    );
  }

  // Check for RP stored correctly
  if (/ReferencePoint\s*\(/.test(script) && !/\.id/.test(script)) {
    issues.push(
      `SELECTION: ReferencePoint created but .id not stored — use rp_feat = a.ReferencePoint(...); rp_obj = a.referencePoints[rp_feat.id].`
    );
  }

  return issues;
}

// ── Region type checks ──
function checkRegionTypes(script: string): string[] {
  const issues: string[] = [];

  // Coupling controlPoint should use Region, not raw RP
  if (/Coupling\s*\(/.test(script) && /controlPoint\s*=\s*[^R]*referencePoints\[/.test(script)) {
    if (!/Region\s*\(\s*referencePoints/.test(script)) {
      issues.push(
        `REGION: Coupling controlPoint must be a Region, not a raw RP object — use regionToolset.Region(referencePoints=...).`
      );
    }
  }

  // setElementType region check
  if (/setElementType\s*\(/.test(script)) {
    if (/setElementType\s*\(\s*regions?\s*=\s*\(\s*\w+\.cells/.test(script) &&
        !/setElementType\s*\(\s*regions?\s*=\s*\(\s*\w+\.cells[^)]*\)/.test(script)) {
      issues.push(
        `REGION: setElementType regions must be a Region(cells=...), not a raw tuple.`
      );
    }
  }

  return issues;
}

// ── Naming convention check ──
function checkNamingConventions(script: string): string[] {
  const issues: string[] = [];

  // Only warn if no naming convention detected at all
  let conventionCount = 0;
  for (const [, pattern] of Object.entries(NAMING_CONVENTIONS)) {
    if (pattern.test(script)) conventionCount++;
  }

  if (conventionCount < 2) {
    issues.push(
      "INFO: Script does not follow deterministic naming convention (P_, SET_, SURF_, STEP_, BC_, LOAD_, JOB_). Debugging will be harder."
    );
  }

  return issues;
}

// ── Pre-flight validation checks in script ──
function checkPreFlightValidation(script: string): string[] {
  const issues: string[] = [];

  // Check if script validates mesh generation
  if (/generateMesh/.test(script) && !/len\s*\(\s*\w+\.elements\s*\)/.test(script)) {
    issues.push(
      "INFO: No mesh validation after generateMesh(). Consider adding: assert len(p.elements) > 0"
    );
  }

  // Check for field output requests
  if (!/fieldOutputRequests|FieldOutputRequest/.test(script)) {
    issues.push(
      "INFO: No explicit field output request. Default outputs may not include stress (S) and displacement (U)."
    );
  }

  return issues;
}

function lintScript(script: string): string[] {
  const issues: string[] = [];

  // Required imports
  for (const pattern of REQUIRED_IMPORTS) {
    if (!pattern.test(script)) {
      issues.push(`Missing required import: ${pattern.source}`);
    }
  }

  // Blocklist
  for (const pattern of BLOCKLIST) {
    if (pattern.test(script)) {
      issues.push(`Blocked dangerous operation: ${pattern.source}`);
    }
  }

  // Structure checks
  for (const [name, pattern] of Object.entries(STRUCTURE_CHECKS)) {
    if (!pattern.test(script)) {
      issues.push(`Missing ${name} definition — script may be incomplete.`);
    }
  }

  // Build order
  issues.push(...checkBuildOrder(script));

  // Selection strategy
  issues.push(...checkSelectionStrategy(script));

  // Region types
  issues.push(...checkRegionTypes(script));

  // Naming conventions
  issues.push(...checkNamingConventions(script));

  // Pre-flight validation
  issues.push(...checkPreFlightValidation(script));

  return issues;
}

// ═══════════════════════════════════════════════════════════════════
// SCHEMA VALIDATION
// ═══════════════════════════════════════════════════════════════════

interface ScriptSchema {
  title: string;
  assumptions: string[];
  script: string;
  notes: string[];
  abaqus_version: string | null;
  units: string | null;
}

function validateSchema(obj: unknown): { valid: boolean; data?: ScriptSchema; error?: string } {
  if (!obj || typeof obj !== "object") return { valid: false, error: "Response is not an object" };
  const o = obj as Record<string, unknown>;
  if (typeof o.title !== "string") return { valid: false, error: "Missing or invalid 'title'" };
  if (!Array.isArray(o.assumptions)) return { valid: false, error: "Missing 'assumptions' array" };
  if (typeof o.script !== "string" || o.script.trim().length < 20)
    return { valid: false, error: "Missing or too short 'script'" };
  if (!Array.isArray(o.notes)) return { valid: false, error: "Missing 'notes' array" };
  return {
    valid: true,
    data: {
      title: o.title as string,
      assumptions: o.assumptions as string[],
      script: o.script as string,
      notes: o.notes as string[],
      abaqus_version: (o.abaqus_version as string) || null,
      units: (o.units as string) || null,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// PROMPT BUILDER — Enterprise-grade system prompt
// ═══════════════════════════════════════════════════════════════════

function buildPrompt(
  userPrompt: string,
  analysisType: string,
  template: string | null,
  options: Record<string, string>,
  repairContext?: { previousIssues: string[]; previousResponse: string }
): string {
  const parts: string[] = [];

  if (repairContext) {
    parts.push(`REPAIR REQUEST: Your previous response had the following issues:
${repairContext.previousIssues.map((i) => `- ${i}`).join("\n")}

Previous (broken) response (truncated):
${repairContext.previousResponse.substring(0, 2000)}

Fix ALL issues and return a corrected JSON response. Pay special attention to:
- Build order (model → material → part → section → assembly → sets → steps → BCs → loads → mesh → job)
- Selection strategy (prefer sets/bounding-box over findAt/index)
- Region types (coupling controlPoint needs Region, not raw RP)
- Deterministic naming (P_, SET_, SURF_, STEP_, BC_, LOAD_, JOB_)`);
  }

  parts.push(`You are an expert Abaqus/CAE Python scripting assistant that produces production-ready, resilient scripts.

═══ CRITICAL RULES ═══
- Use ONLY Abaqus/CAE Python API (abaqus, abaqusConstants, caeModules, etc.)
- NO os/subprocess/socket/requests/eval/exec calls
- NO network access, NO file deletion, NO system commands
- Include proper imports: from abaqus import *, from abaqusConstants import *, from caeModules import *

═══ MANDATORY BUILD ORDER (never deviate) ═══

Phase A — Foundation:
  A1. Create model (delete existing if needed): mdb.Model(name='MODEL_NAME')
  A2. Create materials + sections
  A3. Create parts (sketch → features → partitions)
  A4. Assign sections: p.SectionAssignment(...)
  A5. Create assembly instances: a = mdb.models['...'].rootAssembly; a.Instance(...)
  A6. Create datums/CSYS if needed

Phase B — Targets:
  B1. Create sets (part-level first, then instance-level)
  B2. Create surfaces
  B3. Create reference points: rp_feat = a.ReferencePoint(point=(...)); rp_obj = a.referencePoints[rp_feat.id]
  B4. Create constraints (couplings, ties, rigid bodies) — controlPoint MUST be Region(referencePoints=...)
  B5. Create interactions (contact)

Phase C — Analysis:
  C1. Create steps (Initial → Step-1 → Step-2…)
  C2. Apply BCs in Initial step to prevent rigid body motion
  C3. Apply loads in the correct step
  C4. Define output requests (fieldOutputRequests with S, U at minimum)

Phase D — Discretization:
  D1. Mesh controls + element types (setElementType with proper Region)
  D2. Seeding (global seedPart → local seedEdgeBySize for refinement)
  D3. Generate mesh + validate: assert len(p.elements) > 0

Phase E — Run:
  E1. Create job (delete existing if needed): mdb.Job(name='JOB_...', model='...')
  E2. job.submit(); job.waitForCompletion()

═══ DETERMINISTIC NAMING STANDARD ═══
Parts:       P_<NAME>           (e.g., P_L_BRACKET)
Instances:   I_<NAME>-1
Sets:        SET_<PURPOSE>      (e.g., SET_ALL_CELLS, SET_LOAD_FACE)
Surfaces:    SURF_<PURPOSE>     (e.g., SURF_CONTACT, SURF_PIN_A)
Ref Points:  RP_<PURPOSE>       (e.g., RP_LOAD, RP_PIN_A)
Steps:       STEP_<PURPOSE>     (e.g., STEP_RAMP, STEP_HOLD)
BCs:         BC_<PURPOSE>       (e.g., BC_FIX_BASE)
Loads:       LOAD_<PURPOSE>     (e.g., LOAD_PRESSURE)
Couplings:   CPL_<PURPOSE>
Jobs:        JOB_<MODEL>_<TEST>

═══ SELECTION STRATEGY LADDER (use in this order) ═══

1. Feature handles (BEST): Store .id from ReferencePoint, datum, sketch features
   ✅ rp_feat = a.ReferencePoint(point=(x,y,z)); rp_obj = a.referencePoints[rp_feat.id]

2. Named sets/surfaces (BEST): Create SET_ and SURF_ immediately after geometry, reuse everywhere
   ✅ p.Set(name='SET_LOAD_FACE', faces=p.faces.getByBoundingBox(...))

3. Bounding-box selection (ROBUST): getByBoundingBox() with tolerance
   ✅ faces = p.faces.getByBoundingBox(xMin-tol, yMin-tol, zMin-tol, xMax+tol, yMax+tol, zMax+tol)

4. findAt (ONLY if geometry is locked and point is guaranteed on entity)
   ⚠️ Use sparingly. Add coordinate tolerance.

5. Index-based (NEVER): faces[0], geometry[4] — FORBIDDEN. Breaks on any geometry change.

═══ COMMON PITFALLS TO AVOID ═══
- NEVER use referencePoints.keys()[index] — ordering is unstable
- NEVER pass raw RP objects to Coupling controlPoint — must be Region(referencePoints=...)
- NEVER use setElementType with raw tuple — must be Region(cells=...)
- ALWAYS create sets/surfaces BEFORE referencing them in BCs/loads
- ALWAYS validate mesh: assert len(p.elements) > 0 after generateMesh()

═══ SCRIPT STRUCTURE ═══
Start with a PARAM dict at the top:
  PARAM = dict(L=120.0, W=60.0, t=10.0, ...)

Include parameter validation:
  assert PARAM['L'] > 0, 'Length must be positive'

Include an artifact register:
  REG = {'sets': {}, 'surfaces': {}, 'rps': {}}

═══ RESPONSE FORMAT ═══
Respond with valid JSON only. No markdown. No code fences. Just a JSON object:
{
  "title": "Short descriptive title",
  "assumptions": ["List of assumptions made"],
  "script": "The complete Python script as a single string",
  "notes": ["Any important notes for the user"],
  "abaqus_version": "${options.abaqus_version || "2024"}",
  "units": "${options.units || "SI (mm, N, MPa)"}"
}`);

  if (template) {
    parts.push(`\nUSE THIS TEMPLATE AS A STARTING STRUCTURE:\n${template}`);
  }

  parts.push(`\nDETECTED ANALYSIS TYPE: ${analysisType}`);

  if (options.element_family) {
    parts.push(`ELEMENT FAMILY PREFERENCE: ${options.element_family}`);
  }

  parts.push(`\nUSER REQUEST:\n${userPrompt}`);

  return parts.join("\n\n");
}

// ═══════════════════════════════════════════════════════════════════
// HASH UTILITY
// ═══════════════════════════════════════════════════════════════════

async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ═══════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const traceId = crypto.randomUUID();
  const startTime = Date.now();

  try {
    const { prompt, template_id, options = {} } = await req.json();
    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 5) {
      return new Response(
        JSON.stringify({ ok: false, issues: ["Prompt is too short or missing."], trace_id: traceId }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (prompt.length > 5000) {
      return new Response(
        JSON.stringify({ ok: false, issues: ["Prompt exceeds 5000 character limit."], trace_id: traceId }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const analysisType = detectAnalysisType(prompt);
    const missingReqWarnings = detectMissingRequirements(prompt, analysisType);

    const template = template_id && TEMPLATES[template_id] ? TEMPLATES[template_id] : null;
    const autoTemplate = !template && TEMPLATES[analysisType] ? TEMPLATES[analysisType] : template;

    const MAX_ATTEMPTS = 3;
    let lastRawResponse = "";
    let allIssues: string[] = [...missingReqWarnings];
    let finalData: ScriptSchema | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const repairContext =
        attempt > 0
          ? { previousIssues: allIssues.filter((i) => !i.startsWith("INFO:")), previousResponse: lastRawResponse }
          : undefined;

      const systemPrompt = buildPrompt(prompt, analysisType, autoTemplate || null, options, repairContext);

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
        }),
      });

      if (!aiResponse.ok) {
        if (aiResponse.status === 429) {
          return new Response(
            JSON.stringify({ ok: false, issues: ["Rate limit exceeded. Please try again shortly."], trace_id: traceId }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (aiResponse.status === 402) {
          return new Response(
            JSON.stringify({ ok: false, issues: ["AI usage credits exhausted. Please add credits."], trace_id: traceId }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const errText = await aiResponse.text();
        console.error(`AI gateway error (attempt ${attempt + 1}):`, aiResponse.status, errText);
        throw new Error("AI generation failed");
      }

      const aiData = await aiResponse.json();
      const rawContent = aiData.choices?.[0]?.message?.content || "";
      lastRawResponse = rawContent;

      let cleaned = rawContent.trim();
      cleaned = cleaned.replace(/^```json?\s*\n?/i, "").replace(/\n?```\s*$/i, "");

      let parsed: unknown;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        allIssues = ["Failed to parse AI response as JSON. Retrying..."];
        console.error(`JSON parse failed (attempt ${attempt + 1}):`, cleaned.substring(0, 500));
        continue;
      }

      const validation = validateSchema(parsed);
      if (!validation.valid || !validation.data) {
        allIssues = [`Schema validation failed: ${validation.error}. Retrying...`];
        continue;
      }

      const lintIssues = lintScript(validation.data.script);
      const blockingIssues = lintIssues.filter((i) => !i.startsWith("INFO:") && !i.startsWith("SELECTION:") && !i.startsWith("BUILD ORDER:"));

      if (blockingIssues.length > 0 && attempt < MAX_ATTEMPTS - 1) {
        allIssues = lintIssues;
        console.log(`Lint failed (attempt ${attempt + 1}), ${blockingIssues.length} blocking issues. Retrying...`);
        continue;
      }

      finalData = validation.data;
      allIssues = [...missingReqWarnings, ...lintIssues];
      break;
    }

    const latencyMs = Date.now() - startTime;

    if (!finalData) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, supabaseKey);
        await supabase.from("audit_events").insert({
          event_type: "generation_failed",
          metadata_json: { trace_id: traceId, analysis_type: analysisType, latency_ms: latencyMs },
        });
      } catch (e) {
        console.error("Audit log failed:", e);
      }

      return new Response(
        JSON.stringify({
          ok: false,
          issues: allIssues.length > 0 ? allIssues : ["Failed to generate a valid script after multiple attempts."],
          trace_id: traceId,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log successful generation
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const promptHash = await sha256(prompt);
      const scriptHash = await sha256(finalData.script);

      const authHeader = req.headers.get("authorization");
      let userId: string | null = null;
      if (authHeader) {
        try {
          const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!);
          const { data: { user } } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
          userId = user?.id || null;
        } catch { /* no auth */ }
      }

      if (userId) {
        await supabase.from("generations").insert({
          user_id: userId,
          title: finalData.title,
          prompt_hash: promptHash,
          script_hash: scriptHash,
          model: "google/gemini-3-flash-preview",
          latency_ms: latencyMs,
          success: true,
          issues: allIssues,
          template_id: template_id || analysisType,
          analysis_type: analysisType,
        });
      }

      await supabase.from("audit_events").insert({
        user_id: userId,
        event_type: "generation_success",
        metadata_json: {
          trace_id: traceId,
          analysis_type: analysisType,
          title: finalData.title,
          latency_ms: latencyMs,
          lint_issues: allIssues.length,
        },
      });
    } catch (e) {
      console.error("Tracking insert failed:", e);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        data: finalData,
        analysis_type: analysisType,
        issues: allIssues,
        trace_id: traceId,
        latency_ms: latencyMs,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("generate-abaqus-script error:", e);
    return new Response(
      JSON.stringify({
        ok: false,
        issues: ["Internal server error. Please try again."],
        trace_id: traceId,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
