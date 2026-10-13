import type { Team } from "@/lib/types";

// One row from the match_crowd function: totals across every player in the
// tournament. The split is null below 3 calls so no single call can be read off it.
export interface CrowdRow {
  match_id: string; calls: number;
  home_wins: number | null; draws: number | null; away_wins: number | null;
  avg_home: number | null; avg_away: number | null;
}

// Whole percentages that always add up to 100 (largest remainder gets the spare points).
function shares(counts: number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  const raw = counts.map((c) => (100 * c) / total);
  const out = raw.map(Math.floor);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < 100 - out.reduce((a, b) => a + b, 0); k++) out[order[k][1]]++;
  return out;
}

export function Crowd({ c, home, away }: { c: CrowdRow; home?: Team; away?: Team }) {
  // Below 3 calls there's nothing to show, so the card stays hidden rather than explaining why.
  if (c.home_wins === null || c.draws === null || c.away_wins === null) return null;
  const [h, d, a] = shares([c.home_wins, c.draws, c.away_wins]);
  // Too thin a slice for its label: the colour still shows, the label moves to the line below.
  const seg = (cls: string, pctv: number, label: string) => pctv > 0 && (
    <span className={cls} style={{ flex: pctv }}>{pctv >= 18 ? `${label} ${pctv}%` : ""}</span>
  );
  const thin = [[home?.short_name ?? "Home", h], ["Draw", d], [away?.short_name ?? "Away", a]]
    .filter(([, p]) => (p as number) > 0 && (p as number) < 18);
  return (
    <div className="crowd">
      <div className="crowdhead">
        <span>The crowd</span>
        <span className="muted">{c.calls} call{c.calls === 1 ? "" : "s"} across the tournament</span>
      </div>
      <div className="crowdbar" role="img"
        aria-label={`${h}% ${home?.display_name ?? "home"}, ${d}% draw, ${a}% ${away?.display_name ?? "away"}`}>
        {seg("h", h, home?.short_name ?? "Home")}
        {seg("d", d, "Draw")}
        {seg("a", a, away?.short_name ?? "Away")}
      </div>
      <p className="small muted" style={{ marginTop: 6, marginBottom: 0 }}>
        {thin.map(([n, p]) => `${n} ${p}% · `).join("")}Average <strong className="txt">{Math.round(c.avg_home!)}–{Math.round(c.avg_away!)}</strong>
      </p>
    </div>
  );
}
