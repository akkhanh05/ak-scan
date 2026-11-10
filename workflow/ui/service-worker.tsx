"use client";
import { useEffect } from "react";

/** Registers the offline service worker in production builds only. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const register = () => { void navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` }).catch(() => undefined); };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);
  return null;
}
