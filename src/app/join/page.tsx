"use client";

import Link from "next/link";

// Signed out, AuthGate shows the join form here instead. Signed in, there's nothing to join.
export default function JoinPage() {
  return (
    <div className="card narrow">
      <h2>You&apos;re already on Scrumline</h2>
      <p className="sub">Share your own invite link from the Pools screen to bring mates in.</p>
      <Link className="btn" href="/">Go to Home</Link>
    </div>
  );
}
