import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Sparkles, ArrowLeft, Loader2, Crown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription, PLAN_TIERS, getTierByProductId } from "@/hooks/useSubscription";

const plans = [
  { ...PLAN_TIERS.starter, key: "starter" as const },
  { ...PLAN_TIERS.pro, key: "pro" as const },
  { ...PLAN_TIERS.team, key: "team" as const },
];

const Plans = () => {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { subscribed, productId, status, loading: subLoading } = useSubscription();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  const currentTier = getTierByProductId(productId);

  const handleStartTrial = async (priceId: string, key: string) => {
    if (!session?.access_token) {
      navigate("/auth");
      return;
    }
    setLoadingPlan(key);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { price_id: priceId },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      }
    } catch (e) {
      console.error("Checkout error:", e);
    } finally {
      setLoadingPlan(null);
    }
  };

  const handleManageSubscription = async () => {
    if (!session?.access_token) return;
    try {
      const { data, error } = await supabase.functions.invoke("customer-portal", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (e) {
      console.error("Portal error:", e);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-7 h-7 rounded border border-primary/30 flex items-center justify-center">
            <span className="text-primary font-mono text-xs font-bold">Aq</span>
          </div>
          <span className="text-sm font-semibold text-foreground">Abaqus AI</span>
          {subscribed && (
            <button
              onClick={handleManageSubscription}
              className="ml-auto text-xs text-primary hover:underline"
            >
              Manage subscription
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 py-12">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Choose your plan
          </h1>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            Start with a 3-day free trial on any plan. Cancel anytime.
          </p>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {plans.map((plan) => {
            const isCurrent = currentTier?.productId === plan.productId;
            const isFeatured = "featured" in plan && plan.featured;
            const discount = Math.round(
              ((plan.priceWas - plan.priceNow) / plan.priceWas) * 100
            );

            return (
              <div
                key={plan.key}
                className={`relative rounded-xl border p-6 flex flex-col ${
                  isFeatured
                    ? "border-primary bg-primary/5 shadow-lg shadow-primary/10"
                    : "border-border bg-card"
                } ${isCurrent ? "ring-2 ring-primary" : ""}`}
              >
                {isFeatured && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    Best value
                  </div>
                )}

                {isCurrent && (
                  <div className="absolute -top-3 right-4 px-3 py-0.5 rounded-full bg-accent text-accent-foreground text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                    <Crown className="w-3 h-3" />
                    {status === "trialing" ? "Trial" : "Your plan"}
                  </div>
                )}

                <h3 className="text-lg font-semibold text-foreground mb-1">
                  {plan.name}
                </h3>

                {/* Price */}
                <div className="mb-4">
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-foreground">
                      £{plan.priceNow}
                    </span>
                    <span className="text-sm text-muted-foreground">/mo</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-sm text-muted-foreground line-through">
                      £{plan.priceWas}/mo
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/20">
                      Save {discount}%
                    </span>
                  </div>
                </div>

                {/* Features */}
                <ul className="space-y-2 mb-6 flex-1">
                  {plan.features.map((f, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm text-muted-foreground"
                    >
                      <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                {isCurrent ? (
                  <button
                    onClick={handleManageSubscription}
                    className="w-full rounded-lg px-4 py-2.5 text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    Manage plan
                  </button>
                ) : (
                  <button
                    onClick={() => handleStartTrial(plan.priceId, plan.key)}
                    disabled={!!loadingPlan || subLoading}
                    className={`w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 ${
                      isFeatured
                        ? "bg-primary text-primary-foreground hover:opacity-90"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    }`}
                  >
                    {loadingPlan === plan.key && (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    )}
                    Start free trial
                  </button>
                )}

                <p className="text-[10px] text-muted-foreground text-center mt-2">
                  3-day free trial · Cancel anytime
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Plans;
