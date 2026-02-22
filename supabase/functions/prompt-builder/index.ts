import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a senior Abaqus/CAE simulation engineer helping a user define their finite element model precisely. Your goal is to build a complete, unambiguous prompt that can be fed into an Abaqus script generator.

You MUST ensure the following details are covered before producing the final prompt. Ask conversational, friendly follow-up questions when details are missing — like an experienced colleague would.

## Required Details Checklist:
1. **Geometry**: Shape, dimensions (with units), features (holes, fillets, ribs, etc.)
2. **Material**: Name or properties (E, ν, density, yield stress if plastic)
3. **Analysis Type**: Static, modal, buckling, contact, thermal, dynamic, etc.
4. **Boundary Conditions**: What's fixed/constrained and where (encastre, pinned, symmetry, etc.)
5. **Loads**: Type (force, pressure, moment, gravity), magnitude, location, direction
6. **Mesh Preferences**: Element type preference (hex/tet/quad), approximate seed size, refinement zones
7. **Output Requests**: What results matter (stress, displacement, reaction forces, mode shapes, etc.)
8. **Units System**: SI (m, Pa), mm-N-MPa, or other

## Behavior Rules:
- Start by understanding what the user wants to simulate in plain language
- Ask 1-3 focused questions at a time, never overwhelm
- If the user is vague, suggest reasonable defaults and ask them to confirm
- When you think you have enough info, present a **structured summary** of all details and ask the user to confirm
- After confirmation, output the final prompt inside a special block:

\`\`\`FINAL_PROMPT
[The complete, detailed prompt ready for script generation]
\`\`\`

- The final prompt should be detailed, technical, and self-contained — it must work on its own without any prior context
- Be warm, concise, and professional — like a helpful engineering colleague
- Use bullet points for clarity
- If the user describes something physically unrealistic, gently point it out`;

interface Message {
  role: "user" | "assistant";
  content: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Authentication check ──
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ ok: false, error: "Authentication required." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!
    );
    const { data: { user: authUser }, error: authError } = await authClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !authUser) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid or expired session." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { messages } = (await req.json()) as { messages: Message[] };

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ ok: false, error: "messages array required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Try Lovable AI gateway first, fallback to OpenAI
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    const openaiKey = Deno.env.get("apikey");

    if (!lovableKey && !openaiKey) {
      return new Response(
        JSON.stringify({ ok: false, error: "No AI API key configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages,
    ];

    let resp: Response | null = null;

    // Try Lovable AI first
    if (lovableKey) {
      try {
        resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${lovableKey}`,
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-lite",
            messages: apiMessages,
            temperature: 0.7,
            max_tokens: 2048,
          }),
        });

        if (!resp.ok) {
          console.error("Lovable AI error, falling back to OpenAI:", await resp.text());
          resp = null;
        }
      } catch (e) {
        console.error("Lovable AI fetch failed:", e);
        resp = null;
      }
    }

    // Fallback to OpenAI
    if (!resp && openaiKey) {
      resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: apiMessages,
          temperature: 0.7,
          max_tokens: 2048,
        }),
      });
    }

    if (!resp || !resp.ok) {
      const errText = resp ? await resp.text() : "No API available";
      console.error("AI API error:", errText);
      return new Response(
        JSON.stringify({ ok: false, error: "AI service error" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await resp.json();
    const reply = data.choices?.[0]?.message?.content || "I couldn't generate a response. Please try again.";

    return new Response(
      JSON.stringify({ ok: true, reply }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("Prompt builder error:", e);
    return new Response(
      JSON.stringify({ ok: false, error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
