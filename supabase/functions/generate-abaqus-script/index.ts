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
  /\bimport\s+ctypes\b/,
  /\bimport\s+sys\b.*\bsys\.exit\b/,
];

// ── File IO Policy (replaces blanket open() block) ──
const SAFE_WRITE_EXTENSIONS = ['.csv', '.txt', '.json', '.log', '.rpt', '.dat'];
const SAFE_WRITE_DIR_PATTERN = /^\.\/?outputs?\//i;  // ./output/ or ./outputs/
const FORBIDDEN_PATH_PATTERNS = [
  /\.\.\//,                            // parent traversal
  /^\/(?:home|etc|usr|var|tmp|root)/i, // system directories
  /\.ssh/i,                            // SSH dirs
  /^[A-Z]:\\/i,                        // Windows absolute paths
  /^\/[A-Za-z]/,                       // Unix absolute paths
];

function checkFileIOPolicy(script: string): { severity: string; message: string }[] {
  const issues: { severity: string; message: string }[] = [];
  // Find all open() calls with write/append mode
  const openWriteRegex = /\bopen\s*\(\s*([^,)]+)\s*,\s*['"]([^'"]*)['"]/g;
  let match;
  while ((match = openWriteRegex.exec(script)) !== null) {
    const pathExpr = match[1].trim();
    const mode = match[2];
    const isWrite = /[wa+]/.test(mode);

    if (!isWrite) continue; // read-only opens are always allowed

    // Check for forbidden paths (literal strings only — variables get a WARN)
    const pathStrMatch = pathExpr.match(/^['"]([^'"]+)['"]/);
    if (pathStrMatch) {
      const filePath = pathStrMatch[1];
      // Check forbidden directories
      for (const forbidden of FORBIDDEN_PATH_PATTERNS) {
        if (forbidden.test(filePath)) {
          issues.push({
            severity: 'ERROR',
            message: `FILE IO: Write to forbidden path "${filePath}" — writes must target ./outputs/ directory only.`,
          });
          break;
        }
      }
      // Check extension allowlist
      const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
      if (ext && !SAFE_WRITE_EXTENSIONS.includes(ext)) {
        issues.push({
          severity: 'WARN',
          message: `FILE IO: Write to "${filePath}" uses extension "${ext}" not in safe list (${SAFE_WRITE_EXTENSIONS.join(', ')}). Verify this is intended.`,
        });
      }
      // Check directory — should be in outputs/
      if (!SAFE_WRITE_DIR_PATTERN.test(filePath) && !/JOB_NAME|PARAM|odb_path|csv_path/i.test(pathExpr)) {
        issues.push({
          severity: 'WARN',
          message: `FILE IO: Write to "${filePath}" is outside ./outputs/ directory. Consider using PARAM['output_dir'] for safe writes.`,
        });
      }
    } else {
      // Variable-based path — can't validate statically, emit advisory
      if (!/JOB_NAME|csv_path|output_|results|PARAM\[/i.test(pathExpr)) {
        issues.push({
          severity: 'INFO',
          message: `FILE IO: Write via variable path (${pathExpr.substring(0, 40)}) — ensure it resolves to a safe workspace directory at runtime.`,
        });
      }
    }
  }
  return issues;
}

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

// ── Banned API patterns (common Abaqus scripting mistakes) ──
const BANNED_API_PATTERNS: { pattern: RegExp; message: string; fix: string }[] = [
  {
    pattern: /model\s*\.\s*BoundaryCondition\s*\(/,
    message: "model.BoundaryCondition() is invalid Abaqus API",
    fix: "Use specific BC types: EncastreBC, DisplacementBC, XsymmBC, YsymmBC, ZsymmBC, VelocityBC, etc.",
  },
  {
    pattern: /influenceRegion\s*=\s*EVERYWHERE/,
    message: "influenceRegion=EVERYWHERE is not a valid Abaqus keyword",
    fix: "Use influenceRadius=WHOLE_SURFACE or a numeric radius.",
  },
  {
    pattern: /from\s+abaqus\s+import\s+\*/g,
    message: "Multiple 'from abaqus import *' detected — likely concatenated scripts",
    fix: "Output exactly ONE script per response. Remove duplicate import blocks.",
  },
  {
    pattern: /frictionCoefficient\s*=/,
    message: "frictionCoefficient= keyword is version-sensitive and may fail",
    fix: "Use table=((mu,),) inside TangentialBehavior for cross-version compatibility.",
  },
  {
    pattern: /setElementType\s*\(\s*regions?\s*=\s*(?:CELLS_REGION|cells_region|regionToolset\.Region)/,
    message: "setElementType regions argument must be tuple-wrapped cells, not a Region object",
    fix: "Use: part.setElementType(regions=(part.cells[:],), elemTypes=(elemType,))",
  },
  {
    pattern: /session\.viewports/,
    message: "session.viewports requires GUI — scripts must be noGUI-safe",
    fix: "Remove all viewport/visualization calls. Use odbAccess for postprocessing.",
  },
];

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

// Strip comments, string literals, and docstrings to get executable-only code
function stripNonExecutable(script: string): string {
  // Remove triple-quoted strings (docstrings/multiline strings)
  let cleaned = script.replace(/'''[\s\S]*?'''/g, '""');
  cleaned = cleaned.replace(/"""[\s\S]*?"""/g, '""');
  // Remove single-line comments
  cleaned = cleaned.replace(/#[^\n]*/g, '');
  // Remove string literals (preserve structure but blank content)
  cleaned = cleaned.replace(/'[^'\n]*'/g, "''");
  cleaned = cleaned.replace(/"[^"\n]*"/g, '""');
  return cleaned;
}

function checkBuildOrder(script: string): { severity: string; message: string }[] {
  const issues: { severity: string; message: string }[] = [];
  // Parse only executable code — ignore comments, strings, manifest blocks
  const executableCode = stripNonExecutable(script);
  const positions: { phase: string; pos: number; label: string }[] = [];

  for (const marker of BUILD_ORDER_MARKERS) {
    const match = executableCode.match(marker.pattern);
    if (match && match.index !== undefined) {
      positions.push({ phase: marker.phase, pos: match.index, label: marker.label });
    }
  }

  for (let i = 1; i < positions.length; i++) {
    if (positions[i].pos < positions[i - 1].pos) {
      issues.push({
        severity: 'WARN',
        message: `BUILD ORDER: "${positions[i].label}" appears before "${positions[i - 1].label}" — verify execution sequence is correct.`,
      });
    }
  }

  return issues;
}

// ── Selection strategy analysis ──
function checkSelectionStrategy(script: string): string[] {
  const issues: string[] = [];

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

  if (/referencePoints\.keys\s*\(\s*\)\s*\[/.test(script)) {
    issues.push(
      `SELECTION: Using referencePoints.keys()[index] — key ordering is unstable. Store the feature .id directly instead.`
    );
  }

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

  if (/Coupling\s*\(/.test(script) && /controlPoint\s*=\s*[^R]*referencePoints\[/.test(script)) {
    if (!/Region\s*\(\s*referencePoints/.test(script)) {
      issues.push(
        `REGION: Coupling controlPoint must be a Region, not a raw RP object — use regionToolset.Region(referencePoints=...).`
      );
    }
  }

  if (/setElementType\s*\(/.test(script)) {
    if (/setElementType\s*\([^)]*(?:CELLS_REGION|regionToolset\.Region|Region\s*\(\s*cells)/.test(script)) {
      issues.push(
        `REGION: setElementType regions must be tuple-wrapped cells: regions=(part.cells[:],). Do NOT use Region() or CELLS_REGION().`
      );
    }
    if (/setElementType\s*\(\s*regions?\s*=\s*\w+\.cells\b(?!\s*\[\s*:\s*\])/.test(script)) {
      issues.push(
        `REGION: setElementType regions must slice cells: regions=(part.cells[:],) — missing [:] slice.`
      );
    }
  }

  // SectionAssignment region must be tuple-wrapped, not Region()
  // SectionAssignment must use regionToolset.Region(cells=...), NOT raw tuple
  if (/SectionAssignment\s*\(/.test(script)) {
    if (/SectionAssignment\s*\([^)]*region\s*=\s*\(\s*\w+\.cells/.test(script) &&
        !/regionToolset\.Region/.test(script.match(/SectionAssignment\s*\([^)]+\)/)?.[0] || '')) {
      issues.push(
        `REGION: SectionAssignment region should use regionToolset.Region(cells=p.cells[:]). Raw tuple (p.cells[:],) may be rejected.`
      );
    }
    if (/SectionAssignment\s*\([^)]*region\s*=\s*\w+\.cells\b(?!\s*\[\s*:\s*\])/.test(script)) {
      issues.push(
        `REGION: SectionAssignment region must slice cells: regionToolset.Region(cells=p.cells[:]) — missing [:] slice.`
      );
    }
  }

  // elemCode must be a bare constant, not a string
  if (/ElemType\s*\([^)]*elemCode\s*=\s*['"]/.test(script)) {
    issues.push(
      `MESH: elemCode must be a bare abaqusConstants symbol (e.g., C3D8R), NOT a string like 'C3D8R'.`
    );
  }
  if (/ElemType\s*\([^)]*elemCode\s*=\s*getattr\s*\(/.test(script)) {
    issues.push(
      `MESH: elemCode should be a bare constant (C3D8R, C3D10), not getattr(mesh, ...). Import from abaqusConstants.`
    );
  }

  // elemLibrary must be STANDARD for static/implicit workflows
  if (/ElemType\s*\([^)]*elemLibrary\s*=\s*EXPLICIT/.test(script) && !/ExplicitDynamicsStep/.test(script)) {
    issues.push(
      `MESH: elemLibrary=EXPLICIT used but no ExplicitDynamicsStep found. Use elemLibrary=STANDARD for StaticStep workflows.`
    );
  }

  // ODB access without guards
  if (/openOdb\s*\(/.test(script)) {
    if (!/os\.path\.exists/.test(script)) {
      issues.push(
        `ODB: openOdb() called without os.path.exists() guard. ODB file may not exist if job failed.`
      );
    }
    if (/fieldOutputs\s*\[\s*['"]/.test(script) && !/if\s+['"]\w+['"]\s+in\s+f|if\s+['"]\w+['"]\s+in\s+fo|'S'\s+in\s+fo|'U'\s+in\s+fo/.test(script)) {
      issues.push(
        `ODB: Accessing fieldOutputs['S'] or ['U'] without checking if key exists. Guard with: if 'S' in fo:`
      );
    }
  }

  // History region accessed by heuristic without fallback note
  if (/historyRegions\.keys\(\)/.test(script) && /if\s+['"]Node['"]\s+in\s+hr_key|'RP'\s+in/.test(script)) {
    if (!/SET_RP/.test(script) && !/primary|fallback|heuristic/i.test(script)) {
      issues.push(
        `ODB: History region matched by heuristic string ('Node'/'RP'). Prefer matching by deterministic set name (SET_RP_*) first.`
      );
    }
  }

  return issues;
}

// ── Contact engagement safeguard ──
function checkContactEngagement(script: string): string[] {
  const issues: string[] = [];

  const hasFriction = /TangentialBehavior|friction/i.test(script);
  const hasShearLoad = /SurfaceTraction|ShellEdgeLoad|shear/i.test(script);
  const hasNormalPreload = /STEP_CLAMP|interference|preload|gravity|Gravity|normal.*force|clamp/i.test(script);
  const hasContactInteraction = /SurfaceToSurfaceContactStd|SurfaceToSurfaceContactExp|ContactStd|ContactExp/i.test(script);

  if (hasFriction && hasContactInteraction && hasShearLoad && !hasNormalPreload) {
    issues.push(
      "CONTACT: Friction contact + shear load detected with no normal preload. Add a STEP_CLAMP with a small normal force before STEP_SHEAR to ensure contact engagement."
    );
  }

  return issues;
}

// ── Naming convention check ──
function checkNamingConventions(script: string): string[] {
  const issues: string[] = [];

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

  if (/generateMesh/.test(script) && !/len\s*\(\s*\w+\.elements\s*\)/.test(script)) {
    issues.push(
      "INFO: No mesh validation after generateMesh(). Consider adding: REQUIRE(len(p.elements) > 0, ...)"
    );
  }

  if (!/fieldOutputRequests|FieldOutputRequest/.test(script)) {
    issues.push(
      "INFO: No explicit field output request. Default outputs may not include stress (S) and displacement (U)."
    );
  }

  const setCreations = (script.match(/\.Set\s*\(/g) || []).length;
  const lenChecks = (script.match(/if\s+len\s*\(|len\s*\([^)]+\)\s*==\s*0|len\s*\([^)]+\)\s*>\s*0|REQUIRE\s*\(/g) || []).length;
  if (setCreations > 0 && lenChecks === 0) {
    issues.push(
      "PRE-FLIGHT: No len() checks or REQUIRE() calls before Set/Surface creation — empty selections will cause silent failures."
    );
  }

  if (/generateMesh/.test(script) && !/except.*mesh|except.*Mesh|except\s+Exception.*mesh|MESH_LADDER|mesh_ladder/i.test(script)) {
    issues.push(
      "INFO: No mesh fallback (try/except with coarser seed or element change). Wrap generateMesh() in mesh ladder for resilience."
    );
  }

  // ── try/finally/except detection (syntax error in Python) ──
  if (/\btry\s*:[\s\S]*?\bfinally\s*:[\s\S]*?\bexcept\s/.test(script)) {
    issues.push(
      "SYNTAX: try/finally/except detected — Python requires try/except/finally. Move except BEFORE finally."
    );
  }

  const phaseWraps = (script.match(/PHASE\s+[A-E]\s+(FAILED|failed)/g) || []).length;
  if (script.length > 500 && phaseWraps === 0 && !/raise\s+RuntimeError/.test(script)) {
    issues.push(
      "INFO: No phase-level error wrapping. Wrap each phase (A-E) in try/except with descriptive RuntimeError for debuggability."
    );
  }

  const rpCreations = (script.match(/ReferencePoint\s*\(/g) || []).length;
  const rpIdUsages = (script.match(/\.id\b/g) || []).length;
  if (rpCreations > 0 && rpIdUsages < rpCreations) {
    issues.push(
      "RP HANDLING: Not all ReferencePoint creations store .id — use rp_feat.id to retrieve RP deterministically."
    );
  }

  if (rpCreations > 0 && !/REG\s*\[/.test(script)) {
    issues.push(
      "INFO: No artifact register (REG dict) found. Store created RPs/sets/surfaces in REG for reliable referencing."
    );
  }

  // ── NEW: noGUI safety check ──
  if (/session\.viewports|session\.printToFile|getDisplay|session\.journalOptions/i.test(script)) {
    issues.push(
      "noGUI: Script uses GUI-dependent calls (session.viewports, etc.). Remove for headless/noGUI compatibility."
    );
  }

  // ── NEW: Unit consistency check ──
  if (/density/i.test(script)) {
    // Check for common wrong density (kg/m³ in mm system)
    if (/7[89]\d{2}\.?\d*/.test(script) && /mm|millimeter/i.test(script)) {
      issues.push(
        "UNIT: Density appears to be in kg/m³ (e.g., 7850) but geometry is in mm. For mm/N/MPa use tonne/mm³ (7.85e-9)."
      );
    }
  }

  // ── NEW: Validate BC exists in Initial step ──
  if (/StaticStep|BuckleStep|FrequencyStep/i.test(script)) {
    if (!/EncastreBC|DisplacementBC|XsymmBC|YsymmBC|ZsymmBC|PinnedBC/.test(script)) {
      issues.push(
        "PRE-FLIGHT: No boundary condition found. Model will have rigid body motion without BCs in Initial step."
      );
    }
  }

  // ── NEW: Check for ODB handle closure ──
  if (/openOdb\s*\(/.test(script) && !/\.close\s*\(/.test(script)) {
    issues.push(
      "ODB: ODB opened but never closed. Always close ODB handles: odb.close()"
    );
  }

  // ── Contract: RUN_JOB toggle ──
  if (/Job\s*\(/.test(script) && !/RUN_JOB/.test(script)) {
    issues.push(
      "JOB CONTROL: Missing RUN_JOB toggle. Add 'RUN_JOB = True' at top and wrap submit/wait in 'if RUN_JOB:'."
    );
  }

  // ── Contract: Output requests must include S, E, U, RF ──
  if (/FieldOutputRequest/.test(script)) {
    if (!/['"]RF['"]/.test(script)) {
      issues.push(
        "OUTPUT: FieldOutputRequest missing 'RF' (reaction forces). Add RF to field output variables."
      );
    }
    if (!/['"]E['"]/.test(script)) {
      issues.push(
        "OUTPUT: FieldOutputRequest missing 'E' (strain). Add E to field output variables."
      );
    }
  } else if (/Step\s*\(/.test(script)) {
    issues.push(
      "OUTPUT: No explicit FieldOutputRequest. Add: model.FieldOutputRequest(..., variables=('S', 'E', 'U', 'RF'))."
    );
  }

  // ── Contract: Contact outputs ──
  if (/Contact|contact|friction/i.test(script) && /FieldOutputRequest/.test(script)) {
    if (!/CPRESS/.test(script)) {
      issues.push(
        "OUTPUT: Contact model detected but CPRESS/COPEN not in field outputs. Add contact output variables."
      );
    }
  }

  // ── Contract: History output for RP ──
  if (/ReferencePoint\s*\(/.test(script) && !/HistoryOutputRequest/.test(script)) {
    issues.push(
      "OUTPUT: ReferencePoint exists but no HistoryOutputRequest. Add history output for RP reaction forces."
    );
  }

  // ── Contract: Run Readiness Report ──
  if (script.length > 500 && !/RUN READINESS REPORT|READINESS REPORT/i.test(script)) {
    issues.push(
      "INFO: Missing Run Readiness Report. Add a summary print block showing model, steps, elements, nodes, sets, job, ODB status."
    );
  }

  // ── Contract: Job status verification ──
  if (/\.submit\s*\(/.test(script) && !/job\.status|COMPLETED/.test(script)) {
    issues.push(
      "JOB CONTROL: Job submitted but status not verified. Add: REQUIRE(str(job.status) == 'COMPLETED', ...)."
    );
  }

  // ── Contract: Stability check ──
  if (/Step\s*\(/.test(script) && !/EncastreBC|DisplacementBC|PinnedBC|XsymmBC|YsymmBC|ZsymmBC/.test(script)) {
    issues.push(
      "STABILITY: No displacement BC found. Model will have rigid body motion. Add at least one constraining BC."
    );
  }

  // ── 9-Point: REG dictionary must have all keys ──
  if (/REG\s*=\s*\{/.test(script)) {
    const requiredKeys = ['sets', 'surfaces', 'rps', 'steps', 'bcs', 'loads', 'jobs', 'interactions'];
    const missingKeys = requiredKeys.filter(k => !new RegExp(`['"]${k}['"]\\s*:`).test(script));
    if (missingKeys.length > 0) {
      issues.push(
        `REG: Missing keys in REG dictionary: ${missingKeys.join(', ')}. Initialize ALL: sets, surfaces, rps, steps, bcs, loads, jobs, interactions.`
      );
    }
  } else if (script.length > 500 && /ReferencePoint\s*\(/.test(script)) {
    issues.push(
      "REG: No REG dictionary found. Add: REG = {'sets': {}, 'surfaces': {}, 'rps': {}, 'steps': {}, 'bcs': {}, 'loads': {}, 'jobs': {}, 'interactions': {}}"
    );
  }

  // ── 9-Point: Contact surface surgical precision ──
  if (/SurfaceToSurfaceContactStd|SurfaceToSurfaceContactExp/.test(script)) {
    if (/master\s*=\s*\w+\.surfaces\[.*faces\b/.test(script) || /instance\.faces\b/.test(script)) {
      issues.push(
        "CONTACT: Using broad instance.faces as contact surface. Select only the contact face via getByBoundingBox at the contact interface."
      );
    }
    if (!/NormalBehavior/.test(script)) {
      issues.push(
        "CONTACT: Contact interaction defined but NormalBehavior not set. Add: interactionProperties[...].NormalBehavior(pressureOverclosure=HARD)"
      );
    }
  }

  // ── 9-Point: Section assignment coverage ──
  if (/SectionAssignment/.test(script) && /cells\b/.test(script)) {
    if (!/cells\s*\[\s*:\s*\]|cells\s*,/.test(script) && /SectionAssignment/.test(script)) {
      issues.push(
        "SECTION: SectionAssignment may not cover all cells. Use region=(p.cells[:],) to assign to entire part."
      );
    }
  }

  // ── 9-Point: nlgeom for contact/nonlinear ──
  if (/SurfaceToSurfaceContactStd|SurfaceToSurfaceContactExp|contact/i.test(script)) {
    if (/StaticStep\s*\(/.test(script) && !/nlgeom\s*=\s*ON/.test(script)) {
      issues.push(
        "NLGEOM: Contact model detected but nlgeom not explicitly set to ON. Add nlgeom=ON in StaticStep for contact analyses."
      );
    }
  }

  // ── 9-Point: Python 3 ODB access ──
  if (/odb\.steps\.keys\s*\(\s*\)\s*\[/.test(script) && !/list\s*\(\s*odb\.steps/.test(script)) {
    issues.push(
      "PYTHON3: odb.steps.keys()[-1] is not subscriptable in Python 3. Use: list(odb.steps.keys())[-1]"
    );
  }

  // ── 9-Point: AnalyticRigidSurf for rigid indenters ──
  if (/ANALYTIC_RIGID|analytic.*rigid/i.test(script)) {
    if (/BaseSolidExtrude/.test(script) && /ANALYTIC_RIGID_SURFACE/.test(script)) {
      issues.push(
        "GEOMETRY: Using BaseSolidExtrude for an ANALYTIC_RIGID_SURFACE part. Use AnalyticRigidSurfRevolve or AnalyticRigidSurf2DPlanar instead."
      );
    }
  }

  // ── 9-Point: CLEAN_SLATE option ──
  if (script.length > 800 && !/CLEAN_SLATE/.test(script)) {
    issues.push(
      "INFO: No CLEAN_SLATE option. Add 'CLEAN_SLATE = True' with cleanup logic to delete existing models/jobs before re-runs."
    );
  }

  // ── 9-Point: Structured log header ──
  if (script.length > 500 && /PARAM\s*=\s*dict|PARAM\s*=\s*\{/.test(script) && !/ABAQUS MODEL BUILD LOG|BUILD LOG|Parameter Summary/i.test(script)) {
    issues.push(
      "INFO: No structured log header. Add a parameter summary print block at script start for traceability."
    );
  }

  return issues;
}

// ── Banned API pattern checks ──
function checkBannedPatterns(script: string): string[] {
  const issues: string[] = [];

  for (const { pattern, message, fix } of BANNED_API_PATTERNS) {
    if (pattern.source.includes("from\\s+abaqus")) {
      const matches = script.match(/from\s+abaqus\s+import\s+\*/g);
      if (matches && matches.length > 1) {
        issues.push(`BANNED: ${message}. Fix: ${fix}`);
      }
    } else if (pattern.test(script)) {
      issues.push(`BANNED: ${message}. Fix: ${fix}`);
    }
  }

  return issues;
}

// ── Mesh discipline checks ──
function checkMeshDiscipline(script: string): string[] {
  const issues: string[] = [];

  if (/mesh\.ElemType|mesh\.\w+/i.test(script) && !/import\s+mesh/.test(script)) {
    issues.push("Missing 'import mesh' — mesh.ElemType or mesh module used without importing it.");
  }

  const edgeSeedCount = (script.match(/seedEdgeBySize/g) || []).length;
  const partSeedCount = (script.match(/seedPart/g) || []).length;
  if (edgeSeedCount > 3 && partSeedCount === 0) {
    issues.push(
      "MESH: Excessive edge-level seeding without global seedPart(). Use seedPart() for global size, seedEdgeBySize() ONLY for local refinement."
    );
  }

  return issues;
}

// ── Step/Load discipline checks ──
function checkStepLoadDiscipline(script: string): string[] {
  const issues: string[] = [];

  if (/step\s*=\s*['"]Initial['"]/i.test(script) &&
      /ConcentratedForce|Pressure|SurfaceTraction|Gravity|\.loads/i.test(script)) {
    const lines = script.split("\n");
    for (const line of lines) {
      if (/step\s*=\s*['"]Initial['"]/i.test(line) &&
          /ConcentratedForce|Pressure|SurfaceTraction|Gravity/i.test(line)) {
        issues.push("STEP/LOAD: Load assigned to 'Initial' step — loads should go in a non-Initial step (e.g., STEP_LOAD).");
        break;
      }
    }
  }

  if (/ConcentratedForce|Pressure|SurfaceTraction|Gravity/i.test(script) &&
      !/StaticStep|BuckleStep|FrequencyStep|ImplicitDynamicsStep|ExplicitDynamicsStep|HeatTransferStep/.test(script)) {
    issues.push("STEP/LOAD: Loads present but no explicit non-Initial Step defined. Create a step before applying loads.");
  }

  return issues;
}

// ── Anti-default enforcement ──
function checkAntiDefault(script: string): string[] {
  const issues: string[] = [];

  if (/Elastic.*table\s*=\s*\(\s*\(\s*210000|210\.0e3|2\.1e5/i.test(script) &&
      !/PARAM\s*\[.*E\b|PARAM\s*\[.*elastic|PARAM\s*\[.*youngs/i.test(script) &&
      !/PARAM\s*=.*E\s*=/i.test(script)) {
    issues.push(
      "INFO: Script uses default Steel (E=210 GPa) without parameterization. If user didn't specify material, consider raising RuntimeError('SPEC INCOMPLETE: material') instead."
    );
  }

  return issues;
}

// ── NEW: Version compatibility checks ──
function checkVersionCompatibility(script: string): string[] {
  const issues: string[] = [];

  // Check for keywords that changed across versions
  if (/nodalThicknessField/i.test(script)) {
    issues.push("VERSION: nodalThicknessField is only available in Abaqus 2020+.");
  }

  if (/ContactInitialization/i.test(script) && !/2022|2023|2024/i.test(script)) {
    issues.push("VERSION: ContactInitialization may not be available in Abaqus versions before 2022.");
  }

  // Check for deprecated patterns
  if (/contactControls\s*=\s*['"].*['"]/.test(script) && /SurfaceToSurfaceContactStd/.test(script)) {
    issues.push("VERSION: contactControls string reference in SurfaceToSurfaceContactStd is deprecated in 2023+. Use ContactStd with ContactControl objects.");
  }

  return issues;
}

function lintScript(script: string): string[] {
  const issues: string[] = [];

  // Helper: classify severity from message prefix
  function classifySeverity(msg: string): string {
    if (/^BANNED:|^Blocked|^Missing required import/.test(msg)) return 'ERROR';
    if (/^Missing \w+ definition/.test(msg)) return 'ERROR';
    if (/^SYNTAX:/.test(msg)) return 'ERROR';
    if (/^SELECTION:.*index-based|^REGION:|^CONTACT:.*NormalBehavior|^NLGEOM:|^STABILITY:|^STEP\/LOAD:.*Initial|^PYTHON3:|^UNIT:|^noGUI:|^JOB CONTROL:.*Missing RUN_JOB/.test(msg)) return 'ERROR';
    if (/^PRE-FLIGHT:|^SELECTION:|^OUTPUT:|^REG:|^CONTACT:|^SECTION:|^MESH:|^BUILD ORDER:|^RP HANDLING:|^JOB CONTROL:|^ODB:|^VERSION:/.test(msg)) return 'WARN';
    if (/^INFO:/.test(msg)) return 'INFO';
    return 'WARN';
  }

  // Required imports
  for (const pattern of REQUIRED_IMPORTS) {
    if (!pattern.test(script)) {
      issues.push(`[ERROR] Missing required import: ${pattern.source}`);
    }
  }

  // Blocklist (dangerous operations — always ERROR)
  for (const pattern of BLOCKLIST) {
    if (pattern.test(script)) {
      issues.push(`[ERROR] Blocked dangerous operation: ${pattern.source}`);
    }
  }

  // Structure checks
  for (const [name, pattern] of Object.entries(STRUCTURE_CHECKS)) {
    if (!pattern.test(script)) {
      issues.push(`[ERROR] Missing ${name} definition — script may be incomplete.`);
    }
  }

  // File IO policy (severity-aware)
  for (const issue of checkFileIOPolicy(script)) {
    issues.push(`[${issue.severity}] ${issue.message}`);
  }

  // Build order (severity-aware — uses executable code only)
  for (const issue of checkBuildOrder(script)) {
    issues.push(`[${issue.severity}] ${issue.message}`);
  }

  // All legacy check suites — auto-classify severity
  const legacySuites = [
    checkSelectionStrategy(script),
    checkRegionTypes(script),
    checkContactEngagement(script),
    checkNamingConventions(script),
    checkPreFlightValidation(script),
    checkBannedPatterns(script),
    checkMeshDiscipline(script),
    checkStepLoadDiscipline(script),
    checkAntiDefault(script),
    checkVersionCompatibility(script),
  ];
  for (const suite of legacySuites) {
    for (const msg of suite) {
      const severity = classifySeverity(msg);
      issues.push(`[${severity}] ${msg}`);
    }
  }

  return issues;
}

// ═══════════════════════════════════════════════════════════════════
// ERROR CLASSIFIER (Self-Healing)
// ═══════════════════════════════════════════════════════════════════

interface ErrorClassification {
  category: string;
  pattern: string;
  patchStrategy: string;
  promptHint: string;
}

const ERROR_CLASSIFIERS: ErrorClassification[] = [
  {
    category: "SELECTION_EMPTY",
    pattern: "empty sequence|no entities found|SelectionEmpty|getByBoundingBox returned 0",
    patchStrategy: "Widen bounding box tolerance or switch to findAt with fallback",
    promptHint: "The previous script had empty selections. Use wider bounding boxes with tol = max(0.1, 0.01 * max_dimension). Always validate with REQUIRE(len(...) > 0, ...).",
  },
  {
    category: "MESH_FAILURE",
    pattern: "mesh|Mesh generation|element|hex|tet|C3D|seed|meshing",
    patchStrategy: "Apply mesh ladder: HEX sweep → HEX structured → TET C3D10 → coarser seed",
    promptHint: "Mesh generation failed. Use the MESH_LADDER pattern: try C3D8R sweep, if fails try structured, if fails switch to C3D10 TET, if still fails double seed size.",
  },
  {
    category: "KEYWORD_INVALID",
    pattern: "keyword not recognized|invalid keyword|not valid|not a valid",
    patchStrategy: "Check version compatibility map and swap keyword",
    promptHint: "An Abaqus keyword was invalid. Check if it exists in the target Abaqus version. Use cross-version safe alternatives.",
  },
  {
    category: "OVERCONSTRAINT",
    pattern: "overconstraint|overconstrained|zero pivot|singular|rigid body motion",
    patchStrategy: "Check BCs for redundancy, ensure no conflicting constraints",
    promptHint: "Model is overconstrained or has zero pivots. Review BCs: ensure no duplicate constraints on same DOFs, check for redundant couplings.",
  },
  {
    category: "CONTACT_FAILURE",
    pattern: "contact|friction|slave|master|surface interaction|no contact pressure",
    patchStrategy: "Add engagement step, check surface normals, verify contact pair",
    promptHint: "Contact failed. Ensure: 1) surfaces exist and are non-empty, 2) STEP_CLAMP before shear loads, 3) correct master/slave assignment, 4) friction via table=((mu,),).",
  },
  {
    category: "ODB_ACCESS",
    pattern: "ODB|odb|output database|field output|history output",
    patchStrategy: "Check job completion, verify output request, use odbAccess headless",
    promptHint: "ODB access failed. Ensure: 1) job completed successfully (check .sta), 2) requested field outputs exist, 3) use odbAccess.openOdb() not session, 4) close odb handle.",
  },
  {
    category: "STEP_ERROR",
    pattern: "step|Step|initial|convergence|increment|time period",
    patchStrategy: "Check step parameters, add stabilization, adjust incrementation",
    promptHint: "Step failed. Check: 1) loads not in Initial step, 2) step exists before loads/BCs reference it, 3) for nonlinear: nlgeom=ON, appropriate initial/max increments.",
  },
  {
    category: "REGION_TYPE",
    pattern: "Region|region|coupling|controlPoint|setElementType",
    patchStrategy: "Fix Region wrapping for couplings and setElementType",
    promptHint: "Region type error. For Coupling controlPoint: use regionToolset.Region(referencePoints=(rp_obj,)). For setElementType: use regions=(part.cells[:],) NOT Region().",
  },
];

function classifyError(errorText: string): ErrorClassification | null {
  for (const classifier of ERROR_CLASSIFIERS) {
    const patterns = classifier.pattern.split("|");
    if (patterns.some((p) => new RegExp(p, "i").test(errorText))) {
      return classifier;
    }
  }
  return null;
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
  plan?: ModelPlan;
}

interface ModelPlan {
  geometry_strategy: string;
  mesh_strategy: string;
  bc_strategy: string;
  load_strategy: string;
  selection_strategy: string;
  postprocessing: string;
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
      plan: o.plan as ModelPlan | undefined,
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
  repairContext?: { previousIssues: string[]; previousResponse: string; errorClassification?: ErrorClassification },
  runtimeMode: string = "py3"
): string {
  const parts: string[] = [];

  if (repairContext) {
    parts.push(`REPAIR REQUEST: Your previous response had the following issues:
${repairContext.previousIssues.map((i) => `- ${i}`).join("\n")}

Previous (broken) response (truncated):
${repairContext.previousResponse.substring(0, 2000)}

${repairContext.errorClassification ? `ERROR CLASSIFICATION: ${repairContext.errorClassification.category}
PATCH STRATEGY: ${repairContext.errorClassification.patchStrategy}
SPECIFIC FIX: ${repairContext.errorClassification.promptHint}` : ""}

Fix ALL issues and return a corrected JSON response. Pay special attention to:
- Build order (model → material → part → section → assembly → sets → steps → BCs → loads → mesh → job)
- Selection strategy (prefer sets/bounding-box over findAt/index)
- Region types (coupling controlPoint needs Region, not raw RP)
- Deterministic naming (P_, SET_, SURF_, STEP_, BC_, LOAD_, JOB_)`);
  }

  parts.push(`You are AbaqusScriptPro — an engineering-grade Abaqus/CAE Python 3.x code generator.
Your output must be a COMPLETE, EXECUTABLE Abaqus script for Abaqus/CAE 2020+ with zero manual edits.
NON-NEGOTIABLE GOAL: Generate 10/10 reliability scripts — correct API usage, robust selections,
deterministic build order, validation gates, and robust postprocessing.

═══ WORKFLOW: PLAN FIRST, THEN CODE ═══
Before writing ANY code, you MUST create a plan. Include a "plan" field in your JSON response:
{
  "plan": {
    "geometry_strategy": "How the geometry will be created (sketch approach, partitions, features)",
    "mesh_strategy": "Element type, mesh technique, seed sizes, fallback ladder",
    "bc_strategy": "What BCs, which step, which sets/surfaces",
    "load_strategy": "What loads, which step, RP+coupling vs direct pressure",
    "selection_strategy": "How entities will be selected (bounding box, sets, feature handles)",
    "postprocessing": "What KPIs to extract, how (noGUI-safe odbAccess)"
  }
}
This plan drives the script. Every decision in the code must trace back to the plan.

═══ HARD RULES (must follow — zero tolerance) ═══

RULE 1 — ZERO SYNTAX DEFECTS:
  No stray characters. No unfinished strings. No undefined names.
  No half-edits. No orphaned brackets. Every variable must be defined before use.

RULE 2 — HELPER DEFINITION ORDER:
  Define REQUIRE(), RP_REGION(), SURF() BEFORE any call to them.
  Place helpers immediately after PARAM and REG blocks.

RULE 3 — NO INDEX-BASED SELECTION:
  faces[i], edges[i], cells[i], vertices[i] — ALL FORBIDDEN.
  Never select geometry by raw index. It breaks on any geometry change.

RULE 4 — AVOID findAt():
  Do NOT use findAt() unless explicitly instructed by the user.
  If used, provide a bounding-box fallback.

RULE 5 — REGION OBJECTS (critical — Abaqus will reject wrong types):
  Always use regionToolset.Region() where Abaqus expects a Region argument:
    ✅ regionToolset.Region(faces=faces_seq)
    ✅ regionToolset.Region(cells=cells_seq)
    ✅ regionToolset.Region(referencePoints=(rp_obj,))
  Specific contexts:
    - SectionAssignment: region=regionToolset.Region(cells=p.cells[:])
    - setElementType:    regions=(p.cells[:],)  — tuple-wrapped sequence, NOT Region
    - Coupling controlPoint: regionToolset.Region(referencePoints=(rp_obj,))
    - Loads/BCs: use assembly sets/surfaces directly (a.sets['...'], a.surfaces['...'])
    - RigidBody refPointRegion: regionToolset.Region(referencePoints=(rp_obj,))
  ❌ NEVER pass raw tuples like (p.faces[:],) as a "region" to SectionAssignment.
  ❌ NEVER pass raw RP objects to Coupling controlPoint.

RULE 6 — FIXED BUILD ORDER (must not be violated):
  A) Model creation + PARAM validation + CLEAN_SLATE
  B) Materials (Elastic, Density, Plastic, etc.)
  C) Sections (HomogeneousSolidSection, etc.)
  D) Part geometry (sketch → extrude/revolve → features)
  E) Section assignment (regionToolset.Region(cells=p.cells[:]))
  F) Assembly + instances + positioning (translate/rotate)
  G) Sets + surfaces (prefer assembly-level, validate non-empty)
  H) Steps (StaticStep, etc. — Initial is implicit)
  I) BCs (EncastreBC, DisplacementBC in Initial for rigid body prevention)
  J) Loads (Pressure, ConcentratedForce in non-Initial steps)
  K) Interactions (contact/ties/couplings with surface sanity checks)
  L) Mesh controls + element types + seeds + mesh generation (mesh ladder)
  M) Pre-flight correctness gate (MUST pass before job submission)
  N) Job creation + submit + waitForCompletion
  O) ODB postprocessing (robust, Python 3 safe, no hardcoded keys)
  NOTE: Do NOT add a partition step. Rely on the mesh ladder (TET fallback) for
  complex geometry. Local seeding (seedEdgeBySize) handles refinement.

RULE 7 — SELECTION POLICY:
  Priority order:
    1. Partition-driven named sets (BEST)
    2. Bounding box + tolerance + expected-count check (ROBUST)
    3. findAt with fallback (LAST RESORT — only if explicitly requested)
  After EVERY selection:
    REQUIRE(len(entities) > 0, 'Selection empty: <name> at <bbox>')
    REQUIRE(len(entities) == expected, 'Selection count mismatch: got %d, expected %d')
  If selection returns 0 or ambiguous (> expected), STOP with PRE-FLIGHT FAIL.
  For contact: NEVER use "all faces" as a contact surface. Select ONLY the intended face(s).

RULE 8 — MESHING POLICY:
  Do NOT partition geometry for meshing. Use the mesh ladder with TET fallback instead.
  For local refinement, use seedEdgeBySize on specific edges (selected by bounding box).
  Include mesh ladder fallback:
    3D: SWEEP+HEX(C3D8R) → STRUCTURED+HEX(C3D8R) → FREE+TET(C3D10) → coarser seed
    2D: STRUCTURED+QUAD(CPS8R) → FREE+QUAD(CPS8R) → FREE+TRI(CPS6M) → coarser seed
  elemCode must be bare abaqusConstants symbol: C3D8R, C3D10, CPS8R — NOT strings.
  elemLibrary MUST be STANDARD for StaticStep/ImplicitDynamic workflows.
  elemLibrary=EXPLICIT only for ExplicitDynamicsStep.
  Validate: REQUIRE(len(p.elements) > 0, 'Mesh generated 0 elements')

RULE 9 — SOLVER STABILITY:
  nlgeom=ON when contact or large deformation is present.
  For contact: add STEP_SEAT (small displacement) before STEP_LOAD.
  Use SmoothStepAmplitude for frictional contact ramps.
  Always prevent rigid body motion — at least one constraining BC in Initial.

RULE 10 — POSTPROCESSING POLICY:
  Python 3 safe: list(odb.steps.keys())[-1] — never .keys()[-1] directly.
  Guard EVERY access:
    - os.path.exists(odb_path) before openOdb()
    - len(odb.steps) > 0 before accessing steps
    - 'S' in fo before fo['S']
    - len(field.values) > 0 before max()
  Stress (S) is element-based — never treat as nodal unless explicitly requested.
  History regions: search by deterministic set name (SET_RP_*) FIRST,
    then fall back to heuristic ('Node'/'RP' in key) with a logged warning.
  Always close ODB in finally block (check odb is not None).

RULE 11 — FILE OUTPUT POLICY:
  Writes allowed ONLY to ./outputs/ with safe extensions (.csv, .txt, .json, .log, .rpt, .dat).
  Create folder if missing: os.makedirs('./outputs/', exist_ok=True)
  No absolute paths. No parent traversal (../). No network calls.
  Read-only opens are permitted anywhere.

═══ MANDATORY SCRIPT STRUCTURE ═══

Every script MUST include ALL of the following:

1. PARAM block (single source of truth for all dimensions, loads, materials)
2. CLEAN_SLATE option (delete existing model/job safely)
3. REQUIRE() helper (defined BEFORE first use)
4. RP_REGION() helper
5. REG registry: {'sets':{}, 'surfaces':{}, 'rps':{}, 'steps':{}, 'bcs':{},
                   'loads':{}, 'jobs':{}, 'interactions':{}, 'materials':{}, 'sections':{}}
6. Phase markers (Phase A/B/C/… with try/except/finally per phase — NEVER try/finally/except)
7. Unit consistency check (density units match geometry units)
8. Pre-flight gate (checks: steps, BCs, loads, materials, sections, mesh, contact, outputs)
9. Job submission + completion check + ODB verification
10. ODB KPI extraction (min: max Mises, max displacement magnitude)
11. Run Readiness Report (model, steps, elements, nodes, sets, job, ODB)
12. Script Manifest (comment block at end)

═══ IF ANY REQUIREMENT CANNOT BE MET ═══
Do NOT guess or handwave. STOP and raise:
  raise RuntimeError('PRE-FLIGHT FAIL: <explicit reason and exact missing inputs needed>')

═══ DETERMINISTIC NAMING STANDARD ═══
Parts: P_<NAME>     Instances: I_<NAME>-1    Sets: SET_<PURPOSE>
Surfaces: SURF_<PURPOSE>   Steps: STEP_<PURPOSE>   BCs: BC_<PURPOSE>
Loads: LOAD_<PURPOSE>   Couplings: CPL_<PURPOSE>   Jobs: JOB_<MODEL>_<TEST>

═══ ANTI-DEFAULT RULE ═══
If the user does NOT specify material, element type, or units:
  raise RuntimeError('SPEC INCOMPLETE: <what is missing>')
EXCEPTION: Named materials (steel, aluminum) → use handbook values.
EXCEPTION: Mesh seed → estimate as 1/20th of shortest dimension.

═══ CONTACT ENGAGEMENT RULE ═══
Friction contact + shear load → ALWAYS add STEP_SEAT before STEP_LOAD.
Without normal preload, friction is ill-posed.

═══ COMMON PITFALLS (absolute prohibitions) ═══
- NEVER use referencePoints.keys()[index]
- NEVER use model.BoundaryCondition() — use EncastreBC, DisplacementBC, etc.
- NEVER use influenceRegion=EVERYWHERE — use influenceRadius=WHOLE_SURFACE
- NEVER use frictionCoefficient= — use table=((mu,),)
- NEVER output more than ONE script
- NEVER use session.viewports (noGUI only)
- NEVER use string elemCode: 'C3D8R' — use bare constant C3D8R
- NEVER use getattr(mesh, 'C3D8R') — use C3D8R directly from abaqusConstants
- NEVER write try/finally/except — Python syntax is try/except/finally ONLY
- NEVER use faces[0], edges[0], cells[0], vertices[0] — use getByBoundingBox + REQUIRE
- NEVER use elemLibrary=EXPLICIT for StaticStep — use elemLibrary=STANDARD

═══ HELPER FUNCTIONS (include in every script after PARAM/REG) ═══

def REQUIRE(condition, msg):
    if not condition:
        raise RuntimeError('PRE-FLIGHT FAIL: %s' % msg)

def RP_REGION(assembly, rp_obj):
    import regionToolset
    return regionToolset.Region(referencePoints=(rp_obj,))

def SURF(assembly, name):
    REQUIRE(name in assembly.surfaces, 'Surface %s not found' % name)
    return assembly.surfaces[name]

═══ MESH STRATEGY LADDER (mandatory — include in every script) ═══

\`\`\`python
# ══ MESH LADDER (3D) ══
MESH_LADDER_3D = [
    {'technique': SWEEP,      'elemShape': HEX, 'elemCode': C3D8R,  'label': 'HEX-sweep'},
    {'technique': STRUCTURED, 'elemShape': HEX, 'elemCode': C3D8R,  'label': 'HEX-structured'},
    {'technique': FREE,       'elemShape': TET, 'elemCode': C3D10,  'label': 'TET-free'},
]
MESH_LADDER_2D = [
    {'technique': STRUCTURED, 'elemShape': QUAD, 'elemCode': CPS8R,  'label': 'QUAD-structured'},
    {'technique': FREE,       'elemShape': QUAD, 'elemCode': CPS8R,  'label': 'QUAD-free'},
    {'technique': FREE,       'elemShape': TRI,  'elemCode': CPS6M,  'label': 'TRI-free'},
]

mesh_success = False
for rung in MESH_LADDER_3D:
    for seed_multiplier in [1.0, 1.5, 2.0]:
        try:
            p.setMeshControls(regions=p.cells[:], technique=rung['technique'],
                              elemShape=rung['elemShape'])
            elem_type = mesh.ElemType(elemCode=rung['elemCode'], elemLibrary=STANDARD)
            p.setElementType(regions=(p.cells[:],), elemTypes=(elem_type,))
            p.seedPart(size=PARAM['mesh_size'] * seed_multiplier,
                       deviationFactor=0.1, minSizeFactor=0.1)
            p.generateMesh()
            REQUIRE(len(p.elements) > 0, 'Mesh generated 0 elements')
            mesh_success = True
            break
        except Exception as e_mesh:
            try: p.deleteMesh()
            except: pass
    if mesh_success: break
REQUIRE(mesh_success, 'All mesh strategies exhausted')
\`\`\`

═══ PRE-FLIGHT GATE (mandatory — before job.submit) ═══
Only check artifacts that YOUR script actually created. Do NOT check for loads if the
script has no loads (e.g., modal/buckling). Do NOT check for contact if no contact defined.

\`\`\`python
model = mdb.models[MODEL_NAME]
a = model.rootAssembly
non_initial_steps = [s for s in model.steps.keys() if s != 'Initial']
REQUIRE(len(non_initial_steps) > 0, 'No non-Initial step defined')
REQUIRE(len(model.boundaryConditions) > 0, 'No BCs — rigid body motion')
# Only check loads if this script defines them (not modal/buckling):
if len(model.loads) == 0 and any(hasattr(model.steps[s], 'timePeriod') for s in non_initial_steps):
    print('PRE-FLIGHT WARN: No loads defined — verify this is intentional')
for inst_name, inst in a.instances.items():
    if inst.type == DEFORMABLE_BODY:
        REQUIRE(len(inst.elements) > 0, 'Instance %s has no mesh' % inst_name)
REQUIRE(len(model.materials) > 0, 'No materials defined')
for part_name, part_obj in model.parts.items():
    if part_obj.type == DEFORMABLE_BODY:
        REQUIRE(len(part_obj.sectionAssignments) > 0, 'Part %s has no section' % part_name)
# Only check contact if interactions exist:
if len(model.interactions) > 0:
    for int_name, int_obj in model.interactions.items():
        if hasattr(int_obj, 'master') and hasattr(int_obj, 'slave'):
            print('PRE-FLIGHT: Contact %s verified' % int_name)
\`\`\`

═══ ODB POSTPROCESSING (defensive, Python 3, noGUI) ═══
CRITICAL: Always use try/except/finally — NEVER try/finally/except (syntax error).

\`\`\`python
import os
odb_path = JOB_NAME + '.odb'
odb = None
if not os.path.exists(odb_path):
    print('POST: ODB not found — skipping')
else:
    import odbAccess
    try:
        odb = odbAccess.openOdb(path=odb_path, readOnly=True)
        step_keys = list(odb.steps.keys())
        if len(step_keys) == 0:
            print('POST: No steps in ODB — skipping')
        else:
            last_step = odb.steps[step_keys[-1]]
            if len(last_step.frames) == 0:
                print('POST: No frames in last step — skipping')
            else:
                fo = last_step.frames[-1].fieldOutputs
                if 'S' in fo and len(fo['S'].values) > 0:
                    mises = fo['S'].getScalarField(invariant=MISES)
                    print('KPI: Max Mises = %.4f' % max(v.data for v in mises.values))
                else:
                    print('POST: S field not found or empty')
                if 'U' in fo and len(fo['U'].values) > 0:
                    print('KPI: Max U mag = %.6f' % max(v.magnitude for v in fo['U'].values))
                else:
                    print('POST: U field not found or empty')
                # History: search by SET_RP first (deterministic), then heuristic fallback
                hr_keys = list(last_step.historyRegions.keys())
                target_hr = None
                for hk in hr_keys:
                    if 'SET_RP' in hk.upper():
                        target_hr = last_step.historyRegions[hk]
                        break
                if target_hr is None:
                    for hk in hr_keys:
                        if 'Node' in hk or 'RP' in hk.upper():
                            target_hr = last_step.historyRegions[hk]
                            print('POST: Heuristic HR match (fallback): %s' % hk)
                            break
                if target_hr is not None:
                    for v in ('RF1','RF2','RF3','U1','U2','U3'):
                        if v in target_hr.historyOutputs:
                            ho_data = target_hr.historyOutputs[v].data
                            if len(ho_data) > 0:
                                print('KPI: %s final = %.6f' % (v, ho_data[-1][1]))
    except Exception as e_post:
        print('POST: Error — %s' % str(e_post))
    finally:
        if odb is not None:
            odb.close()
\`\`\`

═══ SCRIPT MANIFEST (include as comments at end of script) ═══

\`\`\`python
# ═══════════════════════════════════════════════════════════
# SCRIPT MANIFEST
# Analysis Type: <type>
# Geometry: <description>
# Selection Strategy: <bounding-box / sets / feature-handle>
# Mesh Strategy: <ladder used>
# BC Summary: <list>
# Load Summary: <list>
# KPIs Extracted: <list>
# Version Target: <version>
# Unit System: <mm/N/MPa or m/N/Pa>
# ═══════════════════════════════════════════════════════════
\`\`\`

═══ ABAQUS SCRIPTING API REFERENCE (from official docs — use these patterns exactly) ═══

--- Model + Part Creation ---
from abaqus import *
from abaqusConstants import *
from caeModules import *
import mesh, regionToolset

myModel = mdb.Model(name='MODEL_NAME')
s = myModel.ConstrainedSketch(name='__profile__', sheetSize=500.0)
s.rectangle(point1=(0.0, 0.0), point2=(L, H))
p = myModel.Part(name='P_BEAM', dimensionality=THREE_D, type=DEFORMABLE_BODY)
p.BaseSolidExtrude(sketch=s, depth=W)

--- Analytical Rigid Surface (Revolve for cylinder/sphere) ---
s_rigid = myModel.ConstrainedSketch(name='__rigid__', sheetSize=500.0)
s_rigid.Line(point1=(0.0, R), point2=(L_cyl, R))  # horizontal line at radius R
p_rigid = myModel.Part(name='P_INDENTER', dimensionality=THREE_D, type=ANALYTIC_RIGID_SURFACE)
p_rigid.AnalyticRigidSurfRevolve(sketch=s_rigid)   # revolves around Y-axis → cylinder
rp_feat = p_rigid.ReferencePoint(point=(0.0, 0.0, 0.0))
# For a sphere: sketch an arc, then revolve

--- Material + Section ---
mat = myModel.Material(name='MAT_STEEL')
mat.Elastic(table=((E, nu),))
mat.Density(table=((density,),))           # tonne/mm³ for mm system: 7.85e-9
mat.Plastic(table=((yield_stress, 0.0),))  # optional
myModel.HomogeneousSolidSection(name='SEC_SOLID', material='MAT_STEEL', thickness=None)
import regionToolset
sec_region = regionToolset.Region(cells=p.cells[:])
p.SectionAssignment(region=sec_region, sectionName='SEC_SOLID')

--- Assembly ---
a = myModel.rootAssembly
a.DatumCsysByDefault(CARTESIAN)
i_beam = a.Instance(name='I_BEAM-1', part=p, dependent=ON)

--- Sets + Surfaces (getByBoundingBox — preferred) ---
tol = PARAM['tol']
fixed_faces = i_beam.faces.getByBoundingBox(xMin=-tol, yMin=-tol, zMin=-tol,
                                             xMax=tol, yMax=H+tol, zMax=W+tol)
REQUIRE(len(fixed_faces) > 0, 'No faces found for SET_FIXED_END')
a.Set(name='SET_FIXED_END', faces=fixed_faces)

top_faces = i_beam.faces.getByBoundingBox(xMin=-tol, yMin=H-tol, zMin=-tol,
                                           xMax=L+tol, yMax=H+tol, zMax=W+tol)
REQUIRE(len(top_faces) > 0, 'No faces found for SURF_TOP')
a.Surface(name='SURF_TOP', side1Faces=top_faces)

--- Steps ---
myModel.StaticStep(name='STEP_LOAD', previous='Initial', timePeriod=1.0,
                   initialInc=0.1, maxInc=1.0, nlgeom=ON, description='Apply load')

--- BCs + Loads ---
myModel.EncastreBC(name='BC_FIXED', createStepName='Initial',
                   region=a.sets['SET_FIXED_END'])
myModel.Pressure(name='LOAD_PRESSURE', createStepName='STEP_LOAD',
                 region=a.surfaces['SURF_TOP'], magnitude=pressure_val)

--- Reference Point + Coupling ---
rp_feat = a.ReferencePoint(point=(x, y, z))
rp_obj = a.referencePoints[rp_feat.id]
rp_region = regionToolset.Region(referencePoints=(rp_obj,))
a.Set(name='SET_RP_LOAD', referencePoints=(rp_obj,))
myModel.Coupling(name='CPL_LOAD', controlPoint=rp_region,
                 surface=a.surfaces['SURF_TOP'],
                 influenceRadius=WHOLE_SURFACE, couplingType=DISTRIBUTING)

--- Contact Interaction ---
myModel.ContactProperty('PROP_CONTACT')
myModel.interactionProperties['PROP_CONTACT'].NormalBehavior(pressureOverclosure=HARD)
myModel.interactionProperties['PROP_CONTACT'].TangentialBehavior(
    formulation=PENALTY, table=((mu,),))   # cross-version safe
myModel.SurfaceToSurfaceContactStd(name='INT_CONTACT', createStepName='STEP_LOAD',
    master=a.surfaces['SURF_MASTER'], slave=a.surfaces['SURF_SLAVE'],
    interactionProperty='PROP_CONTACT', sliding=FINITE)

--- Output Requests ---
myModel.FieldOutputRequest(name='F_OUT', createStepName='STEP_LOAD',
    variables=('S', 'E', 'U', 'RF'))
# Contact outputs:
myModel.FieldOutputRequest(name='F_OUT_CONTACT', createStepName='STEP_LOAD',
    variables=('CPRESS', 'COPEN', 'CSLIP'))
# History output at RP:
myModel.HistoryOutputRequest(name='H_OUT_RP', createStepName='STEP_LOAD',
    region=a.sets['SET_RP_LOAD'], variables=('RF1', 'RF2', 'RF3', 'U1', 'U2', 'U3'))

--- Mesh (part-level for dependent instances) ---
p.setMeshControls(regions=p.cells[:], technique=SWEEP, elemShape=HEX)
elem_type = mesh.ElemType(elemCode=C3D8R, elemLibrary=STANDARD)
p.setElementType(regions=(p.cells[:],), elemTypes=(elem_type,))
p.seedPart(size=mesh_size, deviationFactor=0.1, minSizeFactor=0.1)
p.generateMesh()
REQUIRE(len(p.elements) > 0, 'Mesh generated 0 elements')

--- Job ---
mdb.Job(name=JOB_NAME, model=MODEL_NAME, description='...', numCpus=1)
if RUN_JOB:
    mdb.jobs[JOB_NAME].submit()
    mdb.jobs[JOB_NAME].waitForCompletion()
    REQUIRE(str(mdb.jobs[JOB_NAME].status) == 'COMPLETED', 'Job did not complete')

--- ODB Postprocessing (noGUI-safe, Python 3, defensive) ---
# CRITICAL: Always use try/except/finally — NEVER try/finally/except (syntax error).
import os, odbAccess
odb = None
odb_path = JOB_NAME + '.odb'
if os.path.exists(odb_path):
    try:
        odb = odbAccess.openOdb(path=odb_path, readOnly=True)
        step_keys = list(odb.steps.keys())
        if len(step_keys) > 0:
            last_frame = odb.steps[step_keys[-1]].frames[-1]
            fo = last_frame.fieldOutputs
            if 'S' in fo and len(fo['S'].values) > 0:
                max_mises = max(v.data for v in fo['S'].getScalarField(invariant=MISES).values)
                print('KPI: Max Mises = %.4f' % max_mises)
            if 'U' in fo and len(fo['U'].values) > 0:
                max_u_mag = max(v.magnitude for v in fo['U'].values)
                print('KPI: Max U mag = %.6f' % max_u_mag)
    except Exception as e_odb:
        print('POST: ODB error — %s' % str(e_odb))
    finally:
        if odb is not None:
            odb.close()

═══ MATERIAL DEFINITIONS REFERENCE ═══
Common materials (mm/N/MPa/tonne system):
  Steel:     E=210000 MPa, nu=0.3,  density=7.85e-9 tonne/mm³, yield=250 MPa
  Aluminum:  E=70000 MPa,  nu=0.33, density=2.7e-9  tonne/mm³, yield=270 MPa
  Titanium:  E=110000 MPa, nu=0.34, density=4.43e-9 tonne/mm³, yield=880 MPa
  Concrete:  E=30000 MPa,  nu=0.2,  density=2.4e-9  tonne/mm³
  Copper:    E=120000 MPa, nu=0.34, density=8.96e-9 tonne/mm³, yield=70 MPa
  Rubber:    Hyperelastic (Mooney-Rivlin or Neo-Hookean), density=1.1e-9

For m/N/Pa system: E in Pa, density in kg/m³
Always validate: if PARAM.get('unit_system','mm')=='mm' and density > 1.0: UNIT ERROR

Material definition patterns:
  mat.Elastic(table=((E, nu),))
  mat.Density(table=((density,),))
  mat.Plastic(table=((sigma_y, 0.0), (sigma_uts, eps_uts)))
  mat.Expansion(table=((alpha,),))
  Hyperelastic: mat.Hyperelastic(materialType=ISOTROPIC, testData=OFF,
      type=MOONEY_RIVLIN, table=((C10, C01, D1),))

═══ STABILITY ENFORCEMENT ═══
You MUST ensure the model is stable:
- Prevent rigid body motion — verify at least one displacement constraint exists
- For contact models ensure normal behavior is defined
- For RP couplings ensure region is defined correctly
- If model is under-constrained, auto-add minimal stabilizing constraint and log it

═══ OUTPUT REQUESTS (mandatory defaults) ═══
Default field outputs MUST include: S, E, U, RF
If contact exists, ALSO request: CPRESS, COPEN
Add at least one HistoryOutputRequest if RP exists (reaction forces + displacements)

═══ JOB CONTROL (mandatory pattern) ═══
Include RUN_JOB = True at top. Wrap submit/wait in 'if RUN_JOB:'
Verify job.status == COMPLETED and ODB file exists. Print diagnostics on failure.

═══ POST-RUN ENGINEERING SANITY CHECKS ═══
After completion: print max displacement, total reaction force.
Warn if displacement > 10% of model length.

═══ RUN READINESS REPORT (mandatory — always print at end) ═══
Print: Model name, Step names, Element count, Node count, Set count, Job name, ODB status.

═══ REG DICTIONARY (mandatory — initialize ALL keys) ═══
Every script MUST initialize REG with ALL categories:
REG = {'sets': {}, 'surfaces': {}, 'rps': {}, 'steps': {}, 'bcs': {}, 'loads': {},
       'jobs': {}, 'interactions': {}, 'materials': {}, 'sections': {}}
Register EVERY created artifact: REG['sets']['SET_FIXED_END'] = a.sets['SET_FIXED_END']
This prevents KeyError and enables the Pre-flight Gate to validate all artifacts.

═══ CLEAN_SLATE OPTION ═══
At the top of every script, after PARAM, include:
CLEAN_SLATE = True
if CLEAN_SLATE:
    if MODEL_NAME in mdb.models:
        del mdb.models[MODEL_NAME]
    for j in list(mdb.jobs.keys()):
        if j.startswith('JOB_'):
            del mdb.jobs[j]

═══ RIGID BODY GEOMETRY RULES ═══
- For cylindrical indenters: use AnalyticRigidSurfRevolve (revolve a horizontal line at radius R)
  Do NOT use BaseSolidExtrude for rigid surfaces — it creates a deformable solid, not a rigid surface.
- For flat punch: use AnalyticRigidSurf2DPlanar or Shell Planar
- For sphere: revolve an arc
- Always create RP on rigid part BEFORE assembly

═══ CONTACT SURFACE SELECTION (surgical precision) ═══
- NEVER use instance.faces as a contact surface — too broad, causes instability
- For indenter: select only the bottom face using bounding box at Z_min after placement
- For target body: select only the top face using bounding box at Y_max or Z_max
- Validate: REQUIRE(len(surf_faces) == expected_count, 'Contact surface has %d faces, expected %d')
- If count > expected, disambiguate by face normal:
  selected = [f for f in faces if abs(f.getNormal()[axis] - expected_normal) < 0.1]

═══ STEP ENGAGEMENT STRATEGY (contact problems) ═══
For contact analyses, use deterministic step sequencing:
1. STEP_SEAT:   StaticStep, small displacement (e.g., -0.1mm) to establish contact
2. STEP_LOAD:   StaticStep, full loading
Optional: SmoothStepAmplitude to avoid initial contact shock:
  myModel.SmoothStepAmplitude(name='AMP_RAMP', timeSpan=STEP, data=((0,0),(1,1)))
  # Apply via amplitude='AMP_RAMP' in load/BC definition

═══ MESHING STRATEGY (no partitioning) ═══
Do NOT partition geometry for meshing. The mesh ladder handles geometry that
cannot be swept/structured by falling back to FREE+TET(C3D10).
For local refinement, use seedEdgeBySize on edges selected by bounding box:
  refine_edges = p.edges.getByBoundingBox(xMin=..., yMax=...)
  REQUIRE(len(refine_edges) > 0, 'No edges found for refinement seeding')
  p.seedEdgeBySize(edges=refine_edges, size=PARAM['mesh_size']*0.5)
This is simpler and more reliable than datum-plane partitioning.

═══ DEEP QUALITY GATE (before job.submit — engineering-grade) ═══
Beyond existence checks, verify CORRECTNESS:
G1: Contact pair exists AND property assigned
G2: Rigid body RP is constrained (rigid body constraint or coupling exists)
G3: Section assignment covers ALL cells: REQUIRE(len(p.sectionAssignments) > 0 and
     sum(len(sa.region) for sa in p.sectionAssignments) == len(p.cells))
G4: Output requests exist for KPI channels (S, U minimum)
G5: nlgeom=ON for contact/large-deformation models
G6: Contact surfaces are non-empty and face count matches expectation
G7: Step incrementation is reasonable (initialInc <= maxInc, timePeriod > 0)

═══ RESILIENT SELECTION (across geometry changes) ═══
When using getByBoundingBox, validate results:
- Check expected face count; if count > expected, disambiguate:
  faces = [f for f in bbox_faces if f.getNormal() == expected_direction]
- Log selection: print('SELECTION: %s found %d faces (expected %d)' % (name, len(faces), expected))
- If 0 faces found, try with wider tolerance (2x, then 5x) before failing

═══ STRUCTURED LOG HEADER ═══
Every script should start with a parameter summary:
print('='*60)
print('ABAQUS MODEL BUILD LOG')
print('='*60)
for k, v in sorted(PARAM.items()):
    print('  %-20s = %s' % (k, v))
print('='*60)

═══ STRICT QUALITY GATE (self-check before returning) ═══
Before returning JSON, internally verify: no undefined variables, no region misuse,
all names from naming registry, all sets validated, mesh validated, job validated,
RUN_JOB toggle present, output requests include S/E/U/RF,
Run Readiness Report present, Script Manifest present,
REG dictionary fully initialized, CLEAN_SLATE option present.
If ANY fails, fix automatically before returning.

═══ BEHAVIOURAL STANDARD ═══
You are NOT a code generator. You are a simulation engineer.
Think: Model stability → Region robustness → Step correctness → Mesh validity → Solver readiness.
Only then return final script.

═══ RESPONSE FORMAT ═══
Respond with valid JSON only. No markdown. No code fences. Just a JSON object:
{
  "title": "Short descriptive title",
  "assumptions": ["List of assumptions made"],
  "plan": {
    "geometry_strategy": "...",
    "mesh_strategy": "...",
    "bc_strategy": "...",
    "load_strategy": "...",
    "selection_strategy": "...",
    "postprocessing": "..."
  },
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

  // Python runtime mode
  if (runtimeMode === "py27") {
    parts.push(`═══ PYTHON RUNTIME: 2.7 (Older Abaqus) ═══
The script MUST be compatible with Python 2.7. Strict rules:
- Add header: # -*- coding: utf-8 -*-\\n# PY_RUNTIME: 2.7
- NO f-strings — use % formatting or .format()
- NO "raise X from e" exception chaining
- NO type hints (def func(x: int) -> str)
- NO pathlib, typing, dataclasses
- Use list(dict.keys()) instead of dict.keys() when iterating
- print('text') is acceptable (Abaqus 2.7 supports it)
- Use 'except Exception as e:' not 'except Exception, e:'`);
  } else {
    parts.push(`═══ PYTHON RUNTIME: 3.x (Abaqus 2020+) ═══
Add header: # PY_RUNTIME: 3.x
Modern Python 3 syntax is allowed but keep Abaqus API compatibility.`);
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
    const { prompt, template_id, options = {}, runtime_mode = "py3" } = await req.json();
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

    // Two-tier model chain: primary (strong reasoning) → fallback (fast)
    const MODEL_CHAIN = ["google/gemini-2.5-flash", "openai/gpt-5-mini", "google/gemini-2.5-flash-lite"];
    let lastRawResponse = "";
    let allIssues: string[] = [...missingReqWarnings];
    let finalData: ScriptSchema | null = null;
    let usedModel = MODEL_CHAIN[0];

    for (let modelIdx = 0; modelIdx < MODEL_CHAIN.length; modelIdx++) {
      const model = MODEL_CHAIN[modelIdx];
      
      // Classify previous errors for targeted repair hints
      let errorClassification: ErrorClassification | undefined;
      if (modelIdx > 0 && allIssues.length > 0) {
        const errorText = allIssues.join(" ");
        const classified = classifyError(errorText);
        if (classified) {
          errorClassification = classified;
          console.log(`Error classified as: ${classified.category} → ${classified.patchStrategy}`);
        }
      }

      const repairContext =
        modelIdx > 0
          ? { previousIssues: allIssues.filter((i) => !i.startsWith("INFO:")), previousResponse: lastRawResponse, errorClassification }
          : undefined;

      const systemPrompt = buildPrompt(prompt, analysisType, autoTemplate || null, options, repairContext, runtime_mode);

      const requestBody = {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
      };

      console.log(`Attempt ${modelIdx + 1}/${MODEL_CHAIN.length}: model=${model}, prompt_len=${systemPrompt.length}`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);
      let aiResponse: Response;
      try {
        aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
      } catch (fetchErr) {
        console.error(`Fetch failed (model=${model}):`, fetchErr);
        if (modelIdx < MODEL_CHAIN.length - 1) {
          allIssues = [`Model ${model} timed out, trying next...`];
          continue;
        }
        throw new Error("AI request failed after trying all models");
      } finally {
        clearTimeout(timeout);
      }

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
        console.error(`AI gateway error (model=${model}):`, aiResponse.status, errText);
        if (modelIdx < MODEL_CHAIN.length - 1) {
          allIssues = [`Model ${model} returned ${aiResponse.status}, trying next...`];
          continue;
        }
        throw new Error("AI generation failed after trying all models");
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
        console.error(`JSON parse failed (model=${model}):`, cleaned.substring(0, 500));
        continue;
      }

      const validation = validateSchema(parsed);
      if (!validation.valid || !validation.data) {
        allIssues = [`Schema validation failed: ${validation.error}. Retrying...`];
        continue;
      }

      const lintIssues = lintScript(validation.data.script);

      // Accept the script — lint issues are returned as warnings, not blockers
      finalData = validation.data;
      allIssues = [...missingReqWarnings, ...lintIssues];
      usedModel = model;
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
          model: usedModel,
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
          model_used: usedModel,
          lint_issues: allIssues.length,
          has_plan: !!finalData.plan,
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
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error("generate-abaqus-script error:", errMsg);
    return new Response(
      JSON.stringify({
        ok: false,
        issues: [errMsg.includes("timed out") ? "AI request timed out. Please try again." : "Internal server error. Please try again."],
        trace_id: traceId,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
