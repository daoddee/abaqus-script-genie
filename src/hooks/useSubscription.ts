import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

interface SubscriptionState {
  subscribed: boolean;
  status: string | null;
  productId: string | null;
  subscriptionEnd: string | null;
  trialEnd: string | null;
  loading: boolean;
}

// Map Stripe product IDs to tier names
export const PLAN_TIERS = {
  starter: {
    productId: "prod_U0gBqqaFASEdAx",
    priceId: "price_1T2epYAqi6NuZJQwXgAT1fFZ",
    name: "Starter",
    priceNow: 19,
    priceWas: 29,
    features: [
      "50 script generations/month",
      "Basic templates",
      "Python 3 + 2.7 support",
      "Email support",
    ],
  },
  pro: {
    productId: "prod_U0gCrniQzLY6xy",
    priceId: "price_1T2eppAqi6NuZJQwXXOlG4Zv",
    name: "Pro",
    priceNow: 39,
    priceWas: 59,
    featured: true,
    features: [
      "Unlimited script generations",
      "All templates + custom",
      "Priority AI model",
      "Debug assistant",
      "Priority support",
    ],
  },
  team: {
    productId: "prod_U0gC8gMrJNia3a",
    priceId: "price_1T2eq6Aqi6NuZJQwgZJyhCUx",
    name: "Team",
    priceNow: 99,
    priceWas: 129,
    features: [
      "Everything in Pro",
      "5 team members",
      "Shared template library",
      "Admin dashboard",
      "Dedicated support",
    ],
  },
} as const;

export function getTierByProductId(productId: string | null) {
  if (!productId) return null;
  return Object.values(PLAN_TIERS).find((t) => t.productId === productId) ?? null;
}

export function useSubscription() {
  const { session } = useAuth();
  const [state, setState] = useState<SubscriptionState>({
    subscribed: false,
    status: null,
    productId: null,
    subscriptionEnd: null,
    trialEnd: null,
    loading: true,
  });

  const checkSubscription = useCallback(async () => {
    if (!session?.access_token) {
      setState((s) => ({ ...s, loading: false, subscribed: false }));
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke("check-subscription", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) throw error;

      setState({
        subscribed: data?.subscribed ?? false,
        status: data?.status ?? null,
        productId: data?.product_id ?? null,
        subscriptionEnd: data?.subscription_end ?? null,
        trialEnd: data?.trial_end ?? null,
        loading: false,
      });
    } catch (e) {
      console.error("Subscription check failed:", e);
      setState((s) => ({ ...s, loading: false }));
    }
  }, [session?.access_token]);

  useEffect(() => {
    checkSubscription();
    const interval = setInterval(checkSubscription, 60_000);
    return () => clearInterval(interval);
  }, [checkSubscription]);

  return { ...state, refresh: checkSubscription };
}
