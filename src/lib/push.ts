import { supabase } from "@/lib/supabase";

// Where the app lives, e.g. "/scrumline", so the service worker covers every screen.
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** What this phone or browser can do about notifications right now. */
export type PushState =
  | "unsupported"      // an old browser
  | "needs-home-screen" // iPhone/iPad in Safari: push only works from the home-screen app
  | "blocked"          // the person said no; only the phone's settings can undo it
  | "off"
  | "on";

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return (await navigator.serviceWorker.getRegistration(`${BASE}/`)) ?? await navigator.serviceWorker.register(`${BASE}/sw.js`, { scope: `${BASE}/` });
  } catch { return null; }
}

export async function pushState(): Promise<PushState> {
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported) return isIos() && !isInstalled() ? "needs-home-screen" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

function keyBytes(base64url: string): Uint8Array {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Asks the phone for permission and saves its push address. Returns an error to show, or null. */
export async function turnOn(): Promise<string | null> {
  const { data: key, error } = await supabase.rpc("push_public_key");
  if (error) return error.message;
  if (!key) return "Notifications aren't switched on for the league yet.";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "Notifications are blocked for Scrumline in your phone's settings." : null;
  const reg = await registration();
  if (!reg) return "This browser can't run notifications.";
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key as string) as BufferSource });
  const json = sub.toJSON();
  const { error: saveErr } = await supabase.rpc("save_push_subscription", {
    p_endpoint: sub.endpoint, p_p256dh: json.keys?.p256dh, p_auth: json.keys?.auth,
  });
  return saveErr?.message ?? null;
}

/** Stops notifications on this phone only. */
export async function turnOff(): Promise<void> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}

/** Sign out, and stop this phone getting the last person's notifications. */
export async function signOut(): Promise<void> {
  try { await turnOff(); } catch { /* signing out matters more */ }
  await supabase.auth.signOut();
}

// Android and desktop Chrome offer "Install app" through this event, once, early.
interface InstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
export function watchInstallPrompt() {
  // The layout's inline script catches the event if it fires before this code loads.
  const early = (window as { __bip?: InstallPrompt }).__bip;
  if (early && !deferred) { deferred = early; listeners.forEach((f) => f()); }
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as InstallPrompt; listeners.forEach((f) => f()); });
  window.addEventListener("appinstalled", () => { deferred = null; listeners.forEach((f) => f()); });
}
export function canInstall(): boolean { return deferred !== null; }
export function onInstallChange(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }
export async function install(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  listeners.forEach((f) => f());
  return outcome === "accepted";
}
