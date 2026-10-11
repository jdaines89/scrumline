/**
 * The picture that goes out with a league invite: the league's own picture on
 * one half, Scrumline's shield on the other, and the league's name and code
 * along the foot. A league with no picture gets its name on that half instead
 * (never an invented crest). Drawn on the phone, so it costs nothing to serve.
 */
const W = 1080, H = 1080, TOP = 840;
const INK = "#0d1412", GREEN = "#053120", CHALK = "#e8f0ec", MUTED = "#8aa79a", GOLD = "#e0b23c";

const font = (w: number, px: number) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;

/** Loads a picture so it can be drawn and the canvas still saved: fetched as a blob, so another site's picture never taints it. */
async function load(src: string): Promise<ImageBitmap | HTMLImageElement | null> {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (typeof createImageBitmap === "function") return await createImageBitmap(blob);
    const url = URL.createObjectURL(blob);
    return await new Promise((ok) => {
      const i = new Image();
      i.onload = () => ok(i); i.onerror = () => ok(null); i.src = url;
    });
  } catch { return null; }
}

const size = (img: ImageBitmap | HTMLImageElement) =>
  "naturalWidth" in img ? { w: img.naturalWidth, h: img.naturalHeight } : { w: img.width, h: img.height };

/** Splits a name into lines that fit the width, shrinking the type rather than cutting a word. */
function wrap(g: CanvasRenderingContext2D, text: string, room: number, px: number, min: number, most: number): { lines: string[]; px: number } {
  for (let s = px; ; s -= 4) {
    g.font = font(800, s);
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (g.measureText(next).width <= room || !line) line = next;
      else { lines.push(line); line = w; }
    }
    lines.push(line);
    const fits = lines.length <= most && lines.every((l) => g.measureText(l).width <= room);
    if (fits || s <= min) return { lines, px: s };
  }
}

export async function drawLeagueInvite(leagueName: string, joinCode: string | null, pictureUrl: string | null): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const half = W / 2;
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [pic, shield, word, tag] = await Promise.all([
    pictureUrl ? load(pictureUrl) : Promise.resolve(null),
    load(`${base}/brand/shield.png`), load(`${base}/brand/wordmark.png`), load(`${base}/brand/tagline.png`),
  ]);

  g.fillStyle = INK; g.fillRect(0, 0, W, H);

  // Left: the league. Its picture fills the half, cropped from the middle like a group picture.
  if (pic) {
    const { w, h } = size(pic);
    const s = Math.max(half / w, TOP / h);
    g.drawImage(pic, (half - w * s) / 2, (TOP - h * s) / 2, w * s, h * s);
  } else {
    const shade = g.createLinearGradient(0, 0, 0, TOP);
    shade.addColorStop(0, "#1c2b25"); shade.addColorStop(1, "#0f1815");
    g.fillStyle = shade; g.fillRect(0, 0, half, TOP);
    const pad = 56;
    const { lines, px } = wrap(g, leagueName, half - pad * 2, 96, 40, 5);
    const lh = px * 1.08;
    let y = TOP / 2 - (lines.length * lh) / 2 + px * 0.8;
    g.fillStyle = CHALK; g.textAlign = "center";
    for (const l of lines) { g.fillText(l, half / 2, y); y += lh; }
    g.textAlign = "left";
  }

  // Right: Scrumline, as on the logo.
  g.fillStyle = GREEN; g.fillRect(half, 0, half, TOP);
  const glow = g.createRadialGradient(half * 1.5, TOP * 0.4, 20, half * 1.5, TOP * 0.4, half * 0.8);
  glow.addColorStop(0, "rgba(29,111,77,.55)"); glow.addColorStop(1, "rgba(29,111,77,0)");
  g.fillStyle = glow; g.fillRect(half, 0, half, TOP);
  const mid = half + half / 2;
  if (shield) { const sw = 300, sh = sw * 400 / 354; g.drawImage(shield, mid - sw / 2, 120, sw, sh); }
  if (word) { const ww = 440, wh = ww * 90 / 723; g.drawImage(word, mid - ww / 2, 500, ww, wh); }
  else { g.fillStyle = CHALK; g.font = font(800, 64); g.textAlign = "center"; g.fillText("SCRUMLINE", mid, 560); g.textAlign = "left"; }
  if (tag) { const tw = 400, th = tw * 70 / 545; g.drawImage(tag, mid - tw / 2, 600, tw, th); }

  // The seam between the two, in the logo's gold.
  g.fillStyle = GOLD; g.fillRect(half - 3, 0, 6, TOP);
  g.fillRect(0, TOP, W, 6);

  // Foot: which league, and the code to get in.
  const pad = 64;
  g.fillStyle = "#131e1b"; g.fillRect(0, TOP + 6, W, H - TOP - 6);
  g.fillStyle = MUTED; g.font = font(600, 26); g.fillText("JOIN OUR LEAGUE", pad, TOP + 62);
  const room = joinCode ? W - pad * 2 - 260 : W - pad * 2;
  let s = 54; g.font = font(800, s);
  while (g.measureText(leagueName).width > room && s > 26) { s -= 2; g.font = font(800, s); }
  g.fillStyle = CHALK; g.fillText(leagueName, pad, TOP + 124);
  if (joinCode) {
    g.textAlign = "right";
    g.fillStyle = MUTED; g.font = font(600, 26); g.fillText("CODE", W - pad, TOP + 62);
    g.fillStyle = GOLD; g.font = font(800, 54); g.fillText(joinCode, W - pad, TOP + 124);
    g.textAlign = "left";
  }
  g.fillStyle = MUTED; g.font = font(500, 26); g.fillText("Free rugby calling game. No betting.", pad, TOP + 186);

  return new Promise((ok) => c.toBlob((b) => ok(b!), "image/png"));
}
