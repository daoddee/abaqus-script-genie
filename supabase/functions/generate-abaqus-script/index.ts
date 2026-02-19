import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Analysis type detection ───
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
  return warnings;
}

// ─── Templates ───
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

// ─── Blocklist for dangerous operations ───
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
  /\bopen\s*\([^)]*['"][wa]/,  // open() in write/append mode
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

interface ScriptSchema {
  title: string;
  assumptions: string[];
  script: string;
  notes: string[];
  abaqus_version: string | null;
  units: string | null;
}

function lintScript(script: string): string[] {
  const issues: string[] = [];

  // Check required imports
  for (const pattern of REQUIRED_IMPORTS) {
    if (!pattern.test(script)) {
      issues.push(`Missing required import: ${pattern.source}`);
    }
  }

  // Blocklist check
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

  // Geometry reference pitfalls
  if (/findAt\s*\(\s*\(\s*\(/.test(script)) {
    // findAt is used — check for common issues
    const findAtMatches = script.match(/findAt\s*\(\s*\(\s*\([^)]*\)\s*,?\s*\)/g) || [];
    if (findAtMatches.length > 0) {
      // Warn about hardcoded coordinates
      issues.push(
        "INFO: Script uses findAt() with hardcoded coordinates. These may fail if geometry changes. Consider using getByBoundingBox() or parametric references."
      );
    }
  }

  return issues;
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

// ─── Prompt builder ───
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

Previous (broken) response:
${repairContext.previousResponse.substring(0, 2000)}

Fix ALL issues and return a corrected JSON response.`);
  }

  parts.push(`You are an expert Abaqus/CAE Python scripting assistant.
Generate a complete, production-ready Abaqus Python script.

CRITICAL RULES:
- Use ONLY Abaqus/CAE Python API (abaqus, abaqusConstants, caeModules, etc.)
- NO os/subprocess/socket/requests/eval/exec calls
- NO network access, NO file deletion, NO system commands
- Include proper imports: from abaqus import *, from abaqusConstants import *, from caeModules import *
- Include model, part, material, section, assembly, step, BCs, loads, mesh, and job
- Use descriptive variable names with comments

RESPONSE FORMAT: You MUST respond with valid JSON only. No markdown. No code fences. Just a JSON object:
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

// ─── Hash utility ───
async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Main handler ───
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

    // Intent parsing
    const analysisType = detectAnalysisType(prompt);
    const missingReqWarnings = detectMissingRequirements(prompt, analysisType);

    // Template selection
    const template = template_id && TEMPLATES[template_id] ? TEMPLATES[template_id] : null;

    // Auto-select template if none specified
    const autoTemplate =
      !template && TEMPLATES[analysisType] ? TEMPLATES[analysisType] : template;

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

      // Parse JSON — handle markdown-wrapped JSON
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

      // Validate schema
      const validation = validateSchema(parsed);
      if (!validation.valid || !validation.data) {
        allIssues = [`Schema validation failed: ${validation.error}. Retrying...`];
        continue;
      }

      // Static lint
      const lintIssues = lintScript(validation.data.script);
      const blockingIssues = lintIssues.filter((i) => !i.startsWith("INFO:"));

      if (blockingIssues.length > 0 && attempt < MAX_ATTEMPTS - 1) {
        allIssues = lintIssues;
        console.log(`Lint failed (attempt ${attempt + 1}), ${blockingIssues.length} issues. Retrying...`);
        continue;
      }

      // Success (or last attempt with remaining issues)
      finalData = validation.data;
      allIssues = [...missingReqWarnings, ...lintIssues];
      break;
    }

    const latencyMs = Date.now() - startTime;

    if (!finalData) {
      // Log failed generation
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

      // Extract user from auth header if available
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
