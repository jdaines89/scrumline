/**
 * Team colours and official badges.
 *
 * Badges are the crests TheSportsDB publishes for each team (strBadge on
 * search_all_teams.php?l=Currie Cup). They are hotlinked, never copied into
 * the repo. Building with NEXT_PUBLIC_SHOW_OFFICIAL_LOGOS=0 swaps them for
 * jersey colours (see src/components/team.tsx) -- the unions own these marks.
 *
 * Colours: the Bulls pair is TheSportsDB's strColour1/2; it has no colours on
 * file for the other seven, so those are each union's traditional jersey
 * colour, picked by hand. Tweak them here.
 */
export interface TeamBrand {
  primary: string;   // jersey colour
  ink: string;       // text colour that reads on `primary`
  badge: string | null;
}

const BADGE = "https://r2.thesportsdb.com/images/media/team/badge";

export const TEAM_BRAND: Record<string, TeamBrand> = {
  "142062": { primary: "#2b4d9c", ink: "#ffffff", badge: `${BADGE}/uzsinm1752668938.png` }, // Bulls
  "142063": { primary: "#1d6b3c", ink: "#f4d03f", badge: `${BADGE}/04o3ss1625358974.png` }, // Boland
  "142067": { primary: "#f36f21", ink: "#ffffff", badge: `${BADGE}/fc24hq1752674187.png` }, // Cheetahs
  "142068": { primary: "#d2232a", ink: "#ffffff", badge: `${BADGE}/9m704r1665228008.png` }, // Lions
  "142070": { primary: "#1f6fb8", ink: "#ffffff", badge: `${BADGE}/cv86da1651859337.png` }, // Griquas
  "142072": { primary: "#b5121b", ink: "#ffffff", badge: `${BADGE}/5eltim1651859350.png` }, // Pumas
  "142073": { primary: "#161616", ink: "#ffffff", badge: `${BADGE}/mc8yuh1720081670.png` }, // Sharks
  "142075": { primary: "#0b3a82", ink: "#ffffff", badge: `${BADGE}/z80ejs1651859373.png` }, // WP
};

const FALLBACK: TeamBrand = { primary: "#3b4a44", ink: "#ffffff", badge: null };

export function teamBrand(id: string): TeamBrand {
  return TEAM_BRAND[id] ?? FALLBACK;
}

