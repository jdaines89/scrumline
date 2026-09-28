export interface Competition { id: string; name: string; short_name: string }
export interface Season { id: string; name: string; is_replay: boolean; competition_id: string; starts_on: string | null }
export interface Pool { id: number; season: string; name: string; join_code: string; created_by: string; school_emis: string | null; school_stage: "primary" | "high" | null; school_year: number | null }
export interface Team {
  id: string; display_name: string; short_name: string; stadium: string | null;
  colour: string | null; colour_ink: string | null; badge_url: string | null;
}
export interface Match {
  id: string; season: string; round: number; kickoff_at: string;
  home_team_id: string; away_team_id: string;
  home_score: number | null; away_score: number | null;
  venue: string | null; status: string;
}
export interface Member { user_id: string; email: string; display_name: string; is_admin: boolean; email_reminders: boolean; push_mentions: boolean; reminder_by: "push" | "email"; avatar_path: string | null }
export interface School { emis: string; name: string; town: string | null; no_fee: boolean }
export interface ChatMessage { id: number; author_id: string; body: string; created_at: string; image_path?: string | null }
export interface Entry { id: number; user_id: string; season: string; team_name: string }
export interface Prediction { entry_id: number; match_id: string; home_score: number; away_score: number; is_banker: boolean }
export interface StandingRow {
  team_id: string; played: number; won: number; drawn: number; lost: number;
  points_for: number; points_against: number; diff: number;
  log_points: number; points_exact: boolean; position: number; bonus_points: number;
}
export interface LeaderRow {
  pool_id: number; user_id: string; manager: string; entry_id: number | null; team_name: string | null;
  total_points: number; right_results: number; exact_scores: number; rounds_scored: number;
  res_pts: number; mar_pts: number; cls_pts: number; exa_pts: number; banker_pts: number; matches_scored: number;
}
