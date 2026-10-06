import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { AuthGate } from "@/components/auth-gate";
import { LeagueProvider } from "@/components/league";
import { Nav } from "@/components/nav";
import { Brand } from "@/components/logo";
import { PwaSetup } from "@/components/pwa-setup";
import { PreviewBar } from "@/components/preview-bar";

const description = "Rugby predictions that help fund South African schools. Call the scores and win prizes from local businesses, or sponsor a round and get seen every weekend. Free to play, no betting.";
// Link previews (WhatsApp, iMessage, socials) need an absolute image address, or the app picks its own.
const site = `${process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "https://jdaines89.github.io"}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`;
const card = { url: `${site}/share-card.png`, width: 1200, height: 630, alt: "Scrumline, rugby prediction leagues" };

export const metadata: Metadata = {
  title: "Scrumline",
  description,
  metadataBase: new URL(`${site}/`),
  openGraph: { type: "website", siteName: "Scrumline", title: "Scrumline", description, url: `${site}/`, images: [card] },
  twitter: { card: "summary_large_image", title: "Scrumline", description, images: [card.url] },
  applicationName: "Scrumline",
  appleWebApp: { capable: true, title: "Scrumline", statusBarStyle: "black" },
};

// resizes-content: on Android the page shrinks with the keyboard, so nothing blank opens up between the chat and the keys.
export const viewport: Viewport = { themeColor: "#0d1412", interactiveWidget: "resizes-content" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* Signed in last time: keep the tabs' row open while the app starts, so the page doesn't drop down when they appear. */}
        <script dangerouslySetInnerHTML={{ __html: "try{for(var k in localStorage)if(/^sb-.*-auth-token$/.test(k)){document.documentElement.setAttribute('data-signed-in','');break}}catch(e){}" }} />
        {/* Chrome fires "beforeinstallprompt" once, often before the app's code has loaded. */}
        <script dangerouslySetInnerHTML={{ __html: "addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__bip=e})" }} />
        <PwaSetup />
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
