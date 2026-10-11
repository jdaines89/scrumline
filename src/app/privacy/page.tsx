import Link from "next/link";

export const metadata = { title: "Privacy · Scrumline" };

/**
 * What Scrumline keeps about players and why, in plain words, open to anyone
 * (POPIA's notice). Keep it true to the database: a new kind of personal
 * information, or a new service that receives it, belongs here first.
 */
export default function Privacy() {
  return (
    <div className="rules">
      <div className="card narrow">
        <p className="sp-kicker">Privacy</p>
        <h2>What we keep about you, and why</h2>
        <p className="sub">Version 1, 11 October 2026. Written for South Africa&apos;s Protection of Personal Information Act (POPIA).</p>
      </div>

      <section className="card narrow">
        <h3>1. What we keep</h3>
        <ul>
          <li><strong>Your account:</strong> email address and password. The password is scrambled before it&apos;s stored, so nobody at Scrumline can read it.</li>
          <li><strong>Your profile:</strong> first name, surname, the name you were known by at school, team name and picture, if you add one.</li>
          <li><strong>Your schools:</strong> the schools you went to and the years you were there, if you add them, and which schoolmates confirmed you.</li>
          <li><strong>The game:</strong> your calls, points, leagues and prizes.</li>
          <li><strong>Chat:</strong> messages, photos, stickers, reactions and poll votes.</li>
          <li><strong>Alerts:</strong> a code from your phone&apos;s browser that lets us send you alerts, if you turn them on.</li>
          <li><strong>Problems you report:</strong> what you wrote, the page, the error and your device type, plus your internet address to stop abuse.</li>
          <li><strong>How the app is used:</strong> simple counts such as signing up, making calls and inviting players, so we know what works. No advertising trackers.</li>
          <li><strong>Schools and businesses</strong> that claim an account also give a contact name, phone number and payout details. We keep only the last four digits of a bank account.</li>
        </ul>
      </section>

      <section className="card narrow">
        <h3>2. Why we keep it</h3>
        <ul>
          <li>To run the game: your calls, points, tables and school rankings.</li>
          <li>To send the reminders and alerts you choose. You can switch each one off on Profile.</li>
          <li>To keep chat safe: messages are checked for hate speech, threats, spam and links.</li>
          <li>To pay schools and record every rand given, as the law requires.</li>
          <li>We never sell your information or use it for advertising.</li>
        </ul>
      </section>

      <section className="card narrow">
        <h3>3. Who sees it</h3>
        <ul>
          <li>People in your leagues see your name, team name, picture and schools, your calls once each match kicks off, and your chat messages. Nobody outside your leagues sees your calls or chat.</li>
          <li>Your email address is never shown to other players.</li>
          <li>The people who run Scrumline can see your account to fix problems and moderate chat.</li>
        </ul>
      </section>

      <section className="card narrow">
        <h3>4. Services we use</h3>
        <ul>
          <li><strong>Supabase</strong> stores the data, on servers in Ireland. Ireland is covered by Europe&apos;s data protection law (GDPR), which gives at least the protection POPIA requires.</li>
          <li><strong>Brevo</strong> sends emails such as sign-in codes and reminders.</li>
          <li><strong>Google, Apple and Mozilla</strong> deliver phone alerts. They see the alert, not your account.</li>
          <li><strong>GitHub</strong> hosts the app&apos;s pages. It holds no player data.</li>
          <li><strong>Paystack</strong> handles payments to schools when they start.</li>
        </ul>
      </section>

      <section className="card narrow">
        <h3>5. How long we keep it</h3>
        <ul>
          <li>For as long as you have an account.</li>
          <li>When you delete your account, your personal information is removed straight away. Your calls and points stay under &ldquo;Former player&rdquo;, with no name attached, so other players&apos; tables don&apos;t change.</li>
          <li>Nightly backups hold a copy for up to 14 days, then it&apos;s gone.</li>
          <li>Money records are kept for 5 years, because tax law requires it.</li>
          <li>Records of chat messages removed for breaking the rules are kept to protect other players.</li>
        </ul>
      </section>

      <section className="card narrow">
        <h3>6. Your rights</h3>
        <ul>
          <li><strong>See or correct it:</strong> your details are on Profile, and you can change them there.</li>
          <li><strong>Delete it:</strong> Profile, then <em>Delete my account</em>.</li>
          <li><strong>Ask for a copy, object, or ask anything else:</strong> use <em>Report a problem</em> on Profile or on the sign-in page. It goes straight to the person responsible for your information at Scrumline, and we reply within 30 days.</li>
          <li><strong>Complain:</strong> you can contact South Africa&apos;s Information Regulator at inforegulator.org.za.</li>
        </ul>
      </section>

      <section className="card narrow">
        <h3>7. Keeping it safe</h3>
        <ul>
          <li>Every player has a password, and the database only lets each person see what they&apos;re allowed to.</li>
          <li>Scrumline is for adults (18 and older). We don&apos;t knowingly keep information about children.</li>
          <li>If your information is ever exposed, we&apos;ll tell you and the Information Regulator as soon as we can.</li>
        </ul>
      </section>

      <p className="small muted center"><Link href="/rules/">Rules</Link> · <Link href="/">Back to Scrumline</Link></p>
    </div>
  );
}
