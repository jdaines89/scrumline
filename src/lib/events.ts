import { supabase } from "@/lib/supabase";

/** Things only the app can see. Everything else is logged by the database itself. */
export type AppEvent = "invite_shared" | "recap_shared" | "moment_shared" | "alerts_shown" | "alerts_later" | "mate_card_shown" | "organiser_nudged";

/** Logs a product event for the signed-in player. Never blocks or fails the UI. */
export function logEvent(name: AppEvent, props: Record<string, string | number | boolean> = {}, pool?: number) {
  void supabase.rpc("log_event", { p_name: name, p_props: props, p_pool: pool ?? null })
    .then(() => undefined, () => undefined);
}
