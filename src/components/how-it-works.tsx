/** Scrumline in three lines, for people who haven't played yet. */
const STEPS: { title: string; body: string; icon: React.ReactNode }[] = [
  {
    title: "Call every score",
    body: "Pick the score of each match before kick-off. Back one as your Banker and it counts double.",
    icon: <><rect x="4" y="6" width="16" height="12" rx="2" /><path d="M9 10v4M15 10v4M12 11.5v1" /></>,
  },
  {
    title: "Climb your league",
    body: "Points for the right result, the margin and the exact score. Everyone sees the calls once a game starts.",
    icon: <><path d="M5 19V11M12 19V5M19 19v-6" /></>,
  },
  {
    title: "Play for your school",
    body: "Add the schools you went to and your points count for them too. Local businesses fund things schools need.",
    icon: <><path d="M3 10 12 5l9 5" /><path d="M5 10v9h14v-9" /><path d="M10 19v-4h4v4" /></>,
  },
];

export function HowItWorks() {
  return (
    <section className="how" aria-label="How Scrumline works">
      <h3 className="how-h">How it works</h3>
      <ol>
        {STEPS.map((s) => (
          <li key={s.title}>
            <span className="how-ic" aria-hidden>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{s.icon}</svg>
            </span>
            <span><strong>{s.title}</strong><span className="small muted">{s.body}</span></span>
          </li>
        ))}
      </ol>
      <p className="small muted how-foot">Free to play, no betting. For players 18 and over.</p>
    </section>
  );
}
