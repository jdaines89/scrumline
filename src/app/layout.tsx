import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthGate } from "@/components/auth-gate";
import { LeagueProvider } from "@/components/league";
import { Nav } from "@/components/nav";
import { Brand } from "@/components/logo";
import { PwaSetup } from "@/components/pwa-setup";

export const metadata: Metadata = {
  title: "Scrumline",
  description: "Invite-only rugby prediction leagues on real results: Currie Cup, URC and more.",
  applicationName: "Scrumline",
  appleWebApp: { capable: true, title: "Scrumline", statusBarStyle: "black" },
};

export const viewport: Viewport = { themeColor: "#0d1412" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PwaSetup />
        <header className="top">
          <div className="shell">
            <Brand />
            <Nav />
          </div>
        </header>
        <main className="shell">
          <AuthGate>
            <LeagueProvider>{children}</LeagueProvider>
          </AuthGate>
        </main>
      </body>
    </html>
  );
}
