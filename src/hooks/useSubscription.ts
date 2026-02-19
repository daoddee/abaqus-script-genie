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
    productId: "prod_U0gU0kYENhErbL",
    priceId: "price_1T2f7FAqi6NuZJQwHSudP42z",
    name: "Standard",
    priceNow: 19.99,
    priceWas: 29,
    features: [
      "50 script generations/month",
      "Basic templates",
      "Python 3 + 2.7 support",
      "Email support",
    ],
  },
  pro: {
    productId: "prod_U0gV9KIZT1q4ZY",
    priceId: "price_1T2f8KAqi6NuZJQweW4tlP6D",
    name: "Pro",
    priceNow: 24.99,
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
    productId: "prod_U0gVOJgadWFfbp",
    priceId: "price_1T2f8UAqi6NuZJQwXfLNeMpB",
    name: "Team",
    priceNow: 99.99,
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
