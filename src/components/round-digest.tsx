import { Crest } from "@/components/team";
import type { Digest, Side, SwingGame } from "@/lib/digest";
import type { Team } from "@/lib/types";
import { roundName } from "@/lib/format";

// How the pool called it: your side in the accent colour, everyone else muted.
function Split({ g }: { g: SwingGame }) {
  return (
    <div className="dsplit" aria-hidden>
      {(["home", "draw", "away"] as Side[]).map((s) => g.counts[s] > 0 && (
        <span key={s} className={g.mine === s ? "mine" : undefined} style={{ flex: g.counts[s] }} />
      ))}
    </div>
  );
}

/** The round at a glance, above the match cards once mates' calls show. */
export function RoundDigest({ d, round, open, teamsOf }: {
  d: Digest; round: number; open: number; teamsOf: (matchId: string) => [Team, Team];
}) {
  const foot = [
    d.moreSwings > 0 && `${d.moreSwings} more split${d.moreSwings === 1 ? "" : "s"} below`,
    d.agreed > 0 && `${d.agreed} game${d.agreed === 1 ? "" : "s"} everyone agrees on`,
    open > 0 && `lock ${open} more to see everyone there`,
  ].filter(Boolean).join(" · ");
  return (
    <section className="digest" aria-label={`${roundName(round)} at a glance`}>
      <p className="dkicker">{roundName(round)} at a glance</p>
      <p className="dhead">{d.headline}</p>
      {d.standing && <p className="dstand">{d.standing}</p>}
      <ul className="dlist">
        {d.swings.map((g) => {
          const [h, a] = teamsOf(g.match_id);
          return (
            <li key={g.match_id}>
              <div className="drow">
                <span className="dteams"><Crest team={h} size={18} />{h.display_name}<span className="dv">v</span>{a.display_name}<Crest team={a} size={18} /></span>
                {g.label && <span className="dlabel">{g.label}</span>}
              </div>
              <Split g={g} />
              <p className="dtext">{g.text}{g.bankers.length > 0 && <span className="dbank"> · {g.bankers.join(" · ")}</span>}</p>
            </li>
          );
        })}
      </ul>
      {foot && <p className="dfoot">{foot.charAt(0).toUpperCase() + foot.slice(1)}.</p>}
    </section>
  );
}
