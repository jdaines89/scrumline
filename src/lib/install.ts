/**
 * How to get Scrumline onto this phone's home screen. Only Chrome-family
 * browsers on Android and desktop offer a one-tap install, and only when they
 * choose to, so everyone else gets the steps for the browser they're in.
 */
export type InstallHow =
  | "in-app"      // a link opened inside WhatsApp, Facebook, Instagram etc.: can't install from here
  | "ios-safari"
  | "ios-other"   // Chrome, Firefox or Edge on iPhone
  | "android"
  | "desktop";

export function installHow(ua: string, platform = "", touchPoints = 0): InstallHow {
  if (/FBAN|FBAV|FB_IAB|Instagram|Snapchat|Line\/|WhatsApp|GSA\/|; wv\)/i.test(ua)) return "in-app";
  const ios = /iPad|iPhone|iPod/.test(ua) || (platform === "MacIntel" && touchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? "ios-other" : "ios-safari";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

/**
 * What the alerts card on Home and Predict offers. Installing is never pushed
 * on anyone: the card only offers it when the browser itself can do it in one
 * tap. Everyone else (iPhones, Redmi and other phones without one-tap install,
 * links opened inside WhatsApp) just plays in the browser, with email
 * reminders, and the steps stay on Profile for anyone who goes looking.
 */
export function alertsOffer(state: "unsupported" | "needs-home-screen" | "blocked" | "off" | "on", installable: boolean, installed: boolean): "turn-on" | "install" | null {
  if (state === "off") return "turn-on";
  if ((state === "unsupported" || state === "needs-home-screen") && installable && !installed) return "install";
  return null;
}
