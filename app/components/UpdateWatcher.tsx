"use client";

import { useEffect } from "react";

const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
const CHECK_EVERY_MS = 5 * 60 * 1000;
// Remembers which build we already reloaded for, so a deploy that somehow
// still serves the old bundle can't trap the app in a reload loop.
const RELOADED_FOR_KEY = "quantz-reloaded-for";

function isTyping(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

// Keeps an installed PWA on the latest deploy. iOS can leave the app
// suspended in memory for hours, still running the old JS — so on every
// return to the foreground (and every few minutes while open) this asks the
// server which build is live and reloads if it's not the one running here.
// Also owns the service worker registration: the build id in the sw.js URL
// makes every deploy install a fresh worker with a fresh cache.
export default function UpdateWatcher() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;

    let registration: ServiceWorkerRegistration | undefined;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register(`/sw.js?v=${encodeURIComponent(BUILD_ID)}`, { scope: "/", updateViaCache: "none" })
        .then(r => { registration = r; })
        .catch(() => {});
    }

    let checking = false;
    async function check() {
      if (checking) return;
      checking = true;
      try {
        registration?.update().catch(() => {});
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { buildId } = (await res.json()) as { buildId?: string };
        if (!buildId || buildId === BUILD_ID) return;
        // Don't yank the page out from under a message being typed — the
        // next check (foreground return or the interval) picks it up.
        if (isTyping()) return;
        try {
          if (sessionStorage.getItem(RELOADED_FOR_KEY) === buildId) return;
          sessionStorage.setItem(RELOADED_FOR_KEY, buildId);
        } catch {}
        window.location.reload();
      } catch {
        // offline — try again on the next trigger
      } finally {
        checking = false;
      }
    }

    const onVisibility = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", check);
    const id = setInterval(check, CHECK_EVERY_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", check);
      clearInterval(id);
    };
  }, []);

  return null;
}
