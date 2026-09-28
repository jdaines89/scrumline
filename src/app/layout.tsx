import type { Metadata } from "next";
import "./globals.css";
import { AuthGate } from "@/components/auth-gate";
import { LeagueProvider } from "@/components/league";
import { Nav } from "@/components/nav";
import { Brand } from "@/components/logo";
import { PreviewBar } from "@/components/preview-bar";

export const metadata: Metadata = {
  title: "Scrumline",
  description: "Invite-only rugby prediction leagues on real results: Currie Cup, URC and more.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <div className="shell">
            <Brand />
            <Nav />
          </div>
        </header>
        <PreviewBar />
        <main className="shell">
          <AuthGate>
            <LeagueProvider>{children}</LeagueProvider>
          </AuthGate>
        </main>
      </body>
    </html>
  );
}
