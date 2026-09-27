"use client";

import { useEffect } from "react";
import { registration, watchInstallPrompt } from "@/lib/push";

/** Registers the service worker (for notifications) and listens for "Install app". */
export function PwaSetup() {
  useEffect(() => {
    watchInstallPrompt();
    registration();
  }, []);
  return null;
}
