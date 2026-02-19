import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CHECK-SUBSCRIPTION] ${step}${d}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not set");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Auth error: ${userError.message}`);
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated");
    logStep("User authenticated", { email: user.email });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });

    if (customers.data.length === 0) {
      logStep("No Stripe customer found");
      return new Response(JSON.stringify({ subscribed: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const customerId = customers.data[0].id;
    logStep("Found customer", { customerId });

    // Check active or trialing subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 10,
    });

    const activeSub = subscriptions.data.find(
      (s) => s.status === "active" || s.status === "trialing"
    );

    if (!activeSub) {
      logStep("No active subscription");
      return new Response(JSON.stringify({ subscribed: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const productId = activeSub.items.data[0]?.price?.product as string;
    const subscriptionEnd = new Date(activeSub.current_period_end * 1000).toISOString();
    const trialEnd = activeSub.trial_end
      ? new Date(activeSub.trial_end * 1000).toISOString()
      : null;

    logStep("Active subscription found", {
      status: activeSub.status,
      productId,
      subscriptionEnd,
    });

    return new Response(
      JSON.stringify({
        subscribed: true,
        status: activeSub.status,
        product_id: productId,
        subscription_end: subscriptionEnd,
        trial_end: trialEnd,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
