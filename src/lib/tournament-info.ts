/**
 * A few plain facts about each tournament, shown when you tap its logo.
 * Keyed by competition id. Keep to things that are settled history; leave out
 * anything still to be decided (venues, this season's favourites).
 */
export interface TournamentInfo {
  /** One line: what it is. */
  summary: string;
  /** Who plays and how it runs. */
  format: string;
  /** When in the year it's played. */
  when: string;
  /** What it means for South African rugby. */
  sa: string;
  /** A short history. */
  history: string;
}

export const TOURNAMENT_INFO: Record<string, TournamentInfo> = {
  "4446": {
    summary: "The league that puts the Bulls, Lions, Sharks and Stormers up against the best clubs of Ireland, Scotland, Wales and Italy.",
    format: "16 teams play 18 league games each. The top eight go into quarter-finals, then semi-finals and a final.",
    when: "Late September to June, with breaks for test rugby.",
    sa: "Four South African teams take part. The Stormers won the first URC final in 2022, and a South African team played in every final from 2022 to 2025.",
    history: "It began in 2001 as the Celtic League for Irish, Welsh and Scottish teams. Italian teams joined in 2010 and the Cheetahs and Southern Kings in 2017 (the Pro14). In 2021 the Bulls, Lions, Sharks and Stormers came in and it became the United Rugby Championship.",
  },
  "4550": {
    summary: "Europe's top club competition: the best teams from England, France and the URC.",
    format: "24 teams in four pools of six. Each team plays four pool games against teams from the other leagues, and the best go on to a round of 16, quarter-finals, semi-finals and a final.",
    when: "Pool games in December and January, knockouts in April, the final in May.",
    sa: "South African teams have played in it since 2022-23, earning their place through the URC.",
    history: "It started in 1995 as the Heineken Cup and was relaunched as the Champions Cup in 2014. Toulouse and Leinster have won it the most.",
  },
  "5418": {
    summary: "Europe's second club competition, for teams that didn't make the Champions Cup.",
    format: "18 teams in three pools of six. The best from the pools are joined in the round of 16 by teams that drop down from the Champions Cup.",
    when: "Pool games in December and January, knockouts in April, the final in May.",
    sa: "The Sharks won it in 2024, the first European trophy for a South African team. The Cheetahs play in it as invited guests.",
    history: "It began in 1996 as the European Challenge Cup, a year after the Heineken Cup, and took its current form in 2014.",
  },
  "5069": {
    summary: "South Africa's own provincial championship, and one of the oldest rugby competitions in the world.",
    format: "The provinces play each other in a league, then the top four go to semi-finals and a final.",
    when: "Usually July to September, alongside the test season.",
    sa: "It's where many Springboks first make their name, playing for their home province.",
    history: "The trophy was given by Sir Donald Currie, owner of the Castle shipping line, and the competition dates back to the 1880s. Western Province have won it more than anyone.",
  },
  "5852": {
    summary: "A new world competition between the six European nations and six from the southern hemisphere and Japan.",
    format: "12 teams: England, France, Ireland, Italy, Scotland and Wales against South Africa, New Zealand, Australia, Argentina, Fiji and Japan. Each team plays the six from the other side, three in July and three in November, and it ends with a finals weekend.",
    when: "July and November, then finals at the end of November. It's played in years without a World Cup.",
    sa: "The Springboks play all six European nations, so every November test counts towards a final.",
    history: "World Rugby agreed it in 2024 to give the July and November tests more meaning. 2026 is the first one.",
  },
  "varsity-cup": {
    summary: "South Africa's university rugby championship, played under lights on Monday nights.",
    format: "The universities play each other once in a league, then the top four go to semi-finals and a final.",
    when: "February to April.",
    sa: "Plenty of Springboks and URC players came through it on their way up.",
    history: "It started in 2008. Maties (Stellenbosch) have won it the most.",
  },
};
