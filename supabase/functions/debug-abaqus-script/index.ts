import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ═══════════════════════════════════════════════════════════════════
// PROMPT A — Permanent debugger instruction set
// ═══════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are an Abaqus/CAE Python Script Debugger for Abaqus/Standard. Your goal is to return a corrected script that runs successfully and preserves the engineer's intent.

Operating rules:
1) Be deterministic and minimal: change only what is needed to fix failures and improve robustness.
2) Preserve all names (model, parts, sets, surfaces, steps, BCs, loads, job) unless a name is the cause of failure.
3) Never rely on unstable entity indexing (faces[7], geometry[4], referencePoints.keys()) when a stable alternative exists.
4) Prefer robust selection in this order:
   a) stored feature IDs (ReferencePoint feature id, datum id, etc.)
   b) named sets/surfaces created once and reused
   c) getByBoundingBox with sensible tolerances (default tol = 0.05 mm unless model scale indicates otherwise)
   d) findAt only if the point is guaranteed on the entity
5) Enforce Abaqus build order:
   Model -> Materials/Sections -> Parts -> SectionAssignment -> Assembly -> Sets/Surfaces -> Constraints/Interactions -> Steps -> BCs/Loads -> Mesh -> Outputs -> Job.
6) Always fix common Abaqus API mistakes:
   - Coupling controlPoint must be a Region(referencePoints=(rp,))
   - setElementType expects regions= (plural) and a Region object
   - Mesh module must be imported if mesh.ElemType used
   - BC "free DOF" should be omitted, not set to FREE unless version requires it
7) Add pre-flight validation checks that fail fast:
   - any getByBoundingBox selection must be checked for non-empty
   - surfaces/sets required for constraints/loads must exist and be non-empty
   - mesh must produce elements > 0 for each part
8) Error handling:
   - First classify the failure into one of: SelectionEmpty, WrongRegionType, MissingImport, WrongKeywordSignature, Overconstraint/Singularity, MeshFailure, Step/LoadMisassignment.
   - Apply the corresponding fix pattern.
9) Output format (strict JSON):
   {
     "root_cause": ["bullet 1", "bullet 2"],
     "fix_strategy": ["step 1", "step 2"],
     "corrected_script": "full corrected python script",
     "post_run_checks": ["check 1", "check 2"],
     "error_class": "SelectionEmpty | WrongRegionType | MissingImport | WrongKeywordSignature | Overconstraint | MeshFailure | StepMisassignment | Other",
     "changes_summary": "1-line summary of what changed"
   }
Do not include unnecessary explanations, do not rewrite the script from scratch unless required.
Respond with valid JSON only. No markdown. No code fences.`;

// ═══════════════════════════════════════════════════════════════════
// PROMPT B — Per-run job prompt builder
// ═══════════════════════════════════════════════════════════════════

function buildDebugPrompt(script: string, errorLog: string, intent: string, abaqusVersion?: string): string {
  const parts: string[] = [];

  parts.push(`Task: Debug this Abaqus/CAE Python script so it runs successfully in Abaqus/Standard and preserves intent.

Constraints:
- Keep all existing names unless unavoidable.
- Use robust selection (prefer bounding boxes and stored IDs).
- Add fast pre-flight asserts for selections (non-empty) and mesh element count.
- Minimize changes: do not redesign the model.`);

  if (abaqusVersion) {
    parts.push(`Abaqus Version: ${abaqusVersion}`);
  }

  parts.push(`=== SCRIPT START ===
${script}
=== SCRIPT END ===

=== ERROR LOG START ===
${errorLog}
=== ERROR LOG END ===

=== INTENT START ===
${intent}
=== INTENT END ===`);

  return parts.join("\n\n");
}

// ═══════════════════════════════════════════════════════════════════
// ERROR FINGERPRINTING — classify common Abaqus errors
// ═══════════════════════════════════════════════════════════════════

interface ErrorFingerprint {
  errorClass: string;
  hint: string;
}

const ERROR_PATTERNS: { pattern: RegExp; errorClass: string; hint: string }[] = [
  { pattern: /findAt.*failed|empty\s*sequence|getByBoundingBox.*returned\s*0/i, errorClass: "SelectionEmpty", hint: "A geometry selection returned no entities. Check coordinates and tolerances." },
  { pattern: /Region|regionToolset|controlPoint.*type/i, errorClass: "WrongRegionType", hint: "An object was passed where a Region was expected. Wrap in regionToolset.Region(...)." },
  { pattern: /ImportError|ModuleNotFoundError|from\s+\w+\s+import/i, errorClass: "MissingImport", hint: "A required module import is missing." },
  { pattern: /unexpected\s*keyword|takes\s*\d+\s*positional|invalid\s*keyword\s*argument/i, errorClass: "WrongKeywordSignature", hint: "Wrong API signature used. Check Abaqus scripting reference for correct parameters." },
  { pattern: /zero\s*pivot|singular|rigid\s*body\s*motion|overconstraint/i, errorClass: "Overconstraint", hint: "Model is overconstrained or has rigid body motion. Check BCs and constraints." },
  { pattern: /element\s*distortion|mesh.*fail|no\s*elements|negative\s*jacobian/i, errorClass: "MeshFailure", hint: "Mesh generation failed. Try coarser seed or different element type." },
  { pattern: /step.*not\s*found|load.*wrong\s*step|BC.*initial/i, errorClass: "StepMisassignment", hint: "A load or BC is assigned to the wrong step." },
];

function fingerprint(errorLog: string): ErrorFingerprint {
  for (const { pattern, errorClass, hint } of ERROR_PATTERNS) {
    if (pattern.test(errorLog)) {
      return { errorClass, hint };
    }
  }
  return { errorClass: "Other", hint: "Unclassified error. Manual inspection recommended." };
}

// ═══════════════════════════════════════════════════════════════════
// RESPONSE VALIDATION
// ═══════════════════════════════════════════════════════════════════

interface DebugResponse {
  root_cause: string[];
  fix_strategy: string[];
  corrected_script: string;
  post_run_checks: string[];
  error_class: string;
  changes_summary: string;
}

function validateResponse(obj: unknown): { valid: boolean; data?: DebugResponse; error?: string } {
  if (!obj || typeof obj !== "object") return { valid: false, error: "Response is not an object" };
  const o = obj as Record<string, unknown>;
  if (!Array.isArray(o.root_cause)) return { valid: false, error: "Missing root_cause array" };
  if (!Array.isArray(o.fix_strategy)) return { valid: false, error: "Missing fix_strategy array" };
  if (typeof o.corrected_script !== "string" || o.corrected_script.length < 20)
    return { valid: false, error: "Missing or too short corrected_script" };
  if (!Array.isArray(o.post_run_checks)) return { valid: false, error: "Missing post_run_checks array" };
  return {
    valid: true,
    data: {
      root_cause: o.root_cause as string[],
      fix_strategy: o.fix_strategy as string[],
      corrected_script: o.corrected_script as string,
      post_run_checks: o.post_run_checks as string[],
      error_class: (o.error_class as string) || "Other",
      changes_summary: (o.changes_summary as string) || "",
    },
  };
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
    const { script, error_log, intent, abaqus_version } = await req.json();

    if (!script || typeof script !== "string" || script.length < 20) {
      return new Response(
        JSON.stringify({ ok: false, issues: ["Script is missing or too short."], trace_id: traceId }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!error_log || typeof error_log !== "string" || error_log.length < 5) {
      return new Response(
        JSON.stringify({ ok: false, issues: ["Error log is missing or too short."], trace_id: traceId }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Pre-classify the error for context enrichment
    const fp = fingerprint(error_log);

    const userPrompt = buildDebugPrompt(
      script,
      error_log,
      intent || "Not specified — infer from script structure.",
      abaqus_version
    );

    // Enrich system prompt with fingerprint hint
    const enrichedSystem = `${SYSTEM_PROMPT}\n\nPre-classified error: ${fp.errorClass} — ${fp.hint}\nFocus your fix on this category first.`;

    const MAX_ATTEMPTS = 2;
    let lastRaw = "";
    let finalData: DebugResponse | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const messages: { role: string; content: string }[] = [
        { role: "system", content: enrichedSystem },
        { role: "user", content: userPrompt },
      ];

      if (attempt > 0) {
        messages.push({
          role: "user",
          content: `Your previous response was not valid JSON or failed schema validation. Return ONLY a valid JSON object with keys: root_cause, fix_strategy, corrected_script, post_run_checks, error_class, changes_summary. No markdown, no code fences.`,
        });
      }

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages,
          temperature: 0.15,
        }),
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        console.error(`AI debug error (attempt ${attempt + 1}):`, aiResponse.status, errText);
        if (aiResponse.status === 429) {
          return new Response(
            JSON.stringify({ ok: false, issues: ["Rate limit exceeded."], trace_id: traceId }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        throw new Error("AI debug call failed");
      }

      const aiData = await aiResponse.json();
      const rawContent = aiData.choices?.[0]?.message?.content || "";
      lastRaw = rawContent;

      let cleaned = rawContent.trim().replace(/^```json?\s*\n?/i, "").replace(/\n?```\s*$/i, "");

      let parsed: unknown;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        console.error(`Debug JSON parse failed (attempt ${attempt + 1})`);
        continue;
      }

      const validation = validateResponse(parsed);
      if (validation.valid && validation.data) {
        finalData = validation.data;
        break;
      }
    }

    const latencyMs = Date.now() - startTime;

    if (!finalData) {
      return new Response(
        JSON.stringify({
          ok: false,
          issues: ["Failed to produce a valid debug response."],
          trace_id: traceId,
          error_class: fp.errorClass,
          latency_ms: latencyMs,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        data: finalData,
        error_class: finalData.error_class,
        fingerprint: fp,
        trace_id: traceId,
        latency_ms: latencyMs,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("debug-abaqus-script error:", e);
    return new Response(
      JSON.stringify({
        ok: false,
        issues: ["Internal server error."],
        trace_id: traceId,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
