import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const base = process.env.NEXT_PUBLIC_BASE_PATH || "";

// What a phone needs to put Scrumline on the home screen as an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: `${base}/`,
    name: "Scrumline",
    short_name: "Scrumline",
    description: "Rugby prediction leagues with your mates and your school.",
    start_url: `${base}/`,
    scope: `${base}/`,
    display: "standalone",
    orientation: "portrait",
    background_color: "#0d1412",
    theme_color: "#0d1412",
    icons: [
      { src: `${base}/icons/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${base}/icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${base}/icons/maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
