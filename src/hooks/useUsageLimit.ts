import { useState, useCallback } from "react";
import { useAuth } from "./useAuth";

const FREE_LIMIT = 3;
const STORAGE_KEY = "abaqus_free_usage_count";

function getLocalCount(): number {
  try {
    return parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10);
  } catch {
    return 0;
  }
}

function incrementLocalCount(): number {
  const next = getLocalCount() + 1;
  localStorage.setItem(STORAGE_KEY, String(next));
  return next;
}

export function useUsageLimit() {
  const { user } = useAuth();
  const [usageCount, setUsageCount] = useState(getLocalCount);

  const canGenerate = usageCount < FREE_LIMIT;
  const remaining = Math.max(0, FREE_LIMIT - usageCount);

  const recordUsage = useCallback(() => {
    const newCount = incrementLocalCount();
    setUsageCount(newCount);
  }, []);

  return {
    canGenerate,
    usageCount,
    remaining,
    freeLimit: FREE_LIMIT,
    needsAuth: !user && !canGenerate,
    needsPlan: !!user && !canGenerate,
    recordUsage,
  };
}
