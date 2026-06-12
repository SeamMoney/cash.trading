"use client";

import { useEffect } from "react";

/**
 * Deployment-skew recovery: after a production deploy, clients that loaded the
 * previous build can hit 404s on lazily-loaded chunks (their hashed filenames
 * no longer exist), which crashes the page with "Application error: a
 * client-side exception has occurred". Detect chunk-load failures and reload
 * once so the client picks up the new build — guarded per-pathname so a
 * genuinely broken build can't reload-loop.
 */
const RELOAD_FLAG = "chunk-reload-at";
const RELOAD_WINDOW_MS = 30_000;

function isChunkError(message: string) {
  return /ChunkLoadError|Loading chunk [^ ]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(message);
}

function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) ?? 0);
    if (Date.now() - last < RELOAD_WINDOW_MS) return; // already retried recently
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch { /* storage unavailable — still better to reload than white-screen */ }
  window.location.reload();
}

export function ChunkReload() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (isChunkError(String(event.message ?? ""))) reloadOnce();
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason ?? "");
      if (isChunkError(message)) reloadOnce();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
