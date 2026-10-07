import Link from "next/link";

export const metadata = { title: "Rules · Scrumline" };

/**
 * The competition rules, in plain words, open to anyone. Every prize on
 * Scrumline runs under these; the prize itself (what, from whom, which
 * league and round) is shown on its card in the app.
 */
export default function Rules() {
  return (
    <div className="rules">
      <div className="card narrow">
        <p className="sp-kicker">Rules</p>
        <h2>How Scrumline works, and how prizes are won</h2>
        <p className="sub">Version 1, 5 October 2026. These rules apply to every league, round and prize on Scrumline.</p>
      </div>

      <section className="card narrow">
        <h3>1. Who can play</h3>
        <ul>
          <li>You must be 18 or older. Scrumline is not for school learners.</li>
          <li>Playing is free. Nobody pays to enter a league, call a score or win a prize, and there is nothing to buy.</li>
          <li>One account per person, in your own name. Leagues are private: you join one with a code or a link from someone already in it.</li>
        </ul>
      </section>

      <section className="card narrow">
        <h3>2. The game</h3>
        <ul>
          <li>Call the score of every match in a round. Each call locks at that match&apos;s kickoff, and you can lock earlier yourself (that can&apos;t be undone).</li>
          <li>Points per match: 6 for the right result, 5 for the right winning margin, 2 for each team&apos;s score within 3, and 5 more for the exact score. 20 is the most.</li>
          <li>Your Banker doubles one match&apos;s points each round.</li>
          <li>Results come from a public results feed, usually within two hours of full time. If the feed corrects a result, points are worked out again from the corrected score.</li>
          <li>Your calls count in every league you&apos;re in for that tournament.</li>
        </ul>
      </section>

      <section className="card narrow" id="prizes">
        <h3>3. Round prizes</h3>
        <ul>
          <li>A prize is offered by a named person or business. Scrumline doesn&apos;t supply, hold or guarantee it. The card in the app always shows who offered it.</li>
          <li>A prize can only be added or withdrawn before the round&apos;s first kickoff, and is never changed after that.</li>
          <li>Round prizes are for a league of up to 50 players, in a tournament being played live.</li>
          <li><strong>Winner:</strong> the most points in that league for that round. Ties go to the most exact scores, then the most right results. If still tied, the winners share the prize.</li>
          <li>Only players in the league before the round&apos;s last kickoff can win, and a late joiner&apos;s points count only for matches that kicked off after they joined.</li>
          <li>Whoever offered the prize, and the business it&apos;s in the name of, can&apos;t win it.</li>
          <li>The prize is what the card says, with no cash alternative unless the person offering it agrees to one.</li>
          <li><strong>Delivery:</strong> the winner marks it received in the app. A prize not marked received within 14 days of the round&apos;s last kickoff shows as not delivered for good, and whoever offered it can&apos;t offer another prize until it is.</li>
        </ul>
      </section>

      <section className="card narrow">
        <h3>4. Recruiter prizes</h3>
        <ul>
          <li>A business can offer a prize for a league&apos;s top recruiter of a month. Inviting never earns prediction points.</li>
          <li>A new player counts for whoever&apos;s link brought them in, once they have called 3 matches that have kicked off.</li>
          <li>The result is fixed 7 days after the month ends. Ties share the prize. The same 14-day delivery rule applies.</li>
        </ul>
      </section>

      <section className="card narrow">
        <h3>5. Fair play</h3>
        <ul>
          <li>No second accounts, no automated calls, and no calling for someone else.</li>
          <li>Chat is moderated. Hate speech, threats and bullying are removed and can lead to a mute or a ban.</li>
          <li>If something goes wrong with a prize, report it from the prize card or the chat and an admin will look into it.</li>
        </ul>
      </section>

      <section className="card narrow">
        <h3>6. Sponsors and schools</h3>
        <ul>
          <li>No alcohol, betting or gambling sponsors, ever.</li>
          <li>Money given for schools is a gift that goes to the schools. Every rand is recorded in a ledger that can&apos;t be edited.</li>
        </ul>
      </section>

      <section className="card narrow">
        <h3>7. Your information</h3>
        <ul>
          <li>People in your leagues see your name, team name, calls once they lock, and chat messages. Nobody outside your leagues does.</li>
          <li>Scrumline uses your email only for your account, reminders you can switch off, and prizes you win.</li>
        </ul>
      </section>

      <p className="small muted center"><Link href="/">Back to Scrumline</Link></p>
    </div>
  );
}
