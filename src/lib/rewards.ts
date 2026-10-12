/** One live sponsor reward for a tournament, as my_rewards() returns it. */
export interface MyReward {
  campaign_id: number; title: string; sponsor_name: string | null; achievement_key: string; terms: string | null;
  ends_at: string | null; remaining: number; earned: boolean; claimed: boolean; code: string | null;
  /** Who the business is, when known: shown under the reward with its logo. */
  sponsor_logo?: string | null; sponsor_about?: string | null; sponsor_website?: string | null;
}

/** What the tile under a badge says about its reward, or null when there isn't one. */
export function rewardTag(r: MyReward | undefined): string | null {
  if (!r) return null;
  if (r.claimed) return "Reward claimed";
  if (r.earned) return r.remaining > 0 ? "Claim your reward" : "Rewards all claimed";
  return r.remaining > 0 ? "Reward waiting" : null;
}
