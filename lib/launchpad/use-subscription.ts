"use client";
import { useState, useEffect, useCallback } from "react";

const KEY = "launchpad_subscriptions";

interface Sub { ts: number; price: number; }

function readSubs(): Record<string, Sub> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; }
}

// Returns isSubscribed() and subscribe() for demo in-app gating
export function useSubscription() {
  const [subs, setSubs] = useState<Record<string, Sub>>({});

  useEffect(() => { setSubs(readSubs()); }, []);

  const isSubscribed = useCallback((addr: string) => !!subs[addr], [subs]);

  const subscribe = useCallback((addr: string, price = 29) => {
    const next = { ...readSubs(), [addr]: { ts: Date.now(), price } };
    localStorage.setItem(KEY, JSON.stringify(next));
    setSubs(next);
  }, []);

  return { isSubscribed, subscribe };
}
