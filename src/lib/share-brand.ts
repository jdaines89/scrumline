/**
 * Scrumline's masthead for share pictures, drawn from the logo's own pieces so every
 * picture matches the app header: the gold-edged shield, SCRUM in chalk with LINE in
 * gold, and the brush-lettered "Get OUR schools over the line" underneath.
 */
import { drawTagline } from "@/lib/tagline";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const BRAND_GREEN = "#053120";
export const DESCRIPTOR = "Free to play. Played for bragging rights.";

export interface BrandArt { shield: HTMLImageElement | null; word: HTMLImageElement | null; tag: HTMLImageElement | null }

function load(src: string): Promise<HTMLImageElement | null> {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ok(null);
    img.src = src;
    setTimeout(() => ok(null), 3000);
  });
}

export async function loadBrand(): Promise<BrandArt> {
  const [shield, word, tag] = await Promise.all([
    load(`${base}/brand/shield.png`), load(`${base}/brand/wordmark.png`), load(`${base}/brand/tagline.png`),
  ]);
  return { shield, word, tag };
}

/** Shield on the left, wordmark and tagline beside it; `h` is the shield's height. Returns the masthead's bottom edge. */
export function drawMasthead(g: CanvasRenderingContext2D, art: BrandArt, x: number, y: number, h: number): number {
  g.save();
  const sw = h * 354 / 400;
  if (art.shield) {
    g.shadowColor = "rgba(0,0,0,.45)"; g.shadowBlur = h * .08; g.shadowOffsetY = h * .03;
    g.drawImage(art.shield, x, y, sw, h);
    g.shadowColor = "transparent";
  }
  const tx = x + (art.shield ? sw + h * .16 : 0);
  const wh = h * .42, ww = wh * 723 / 90;
  const top = y + h * .1;
  if (art.word) g.drawImage(art.word, tx, top, ww, wh);
  else {
    g.font = `900 ${Math.round(wh)}px system-ui, sans-serif`; g.textBaseline = "top";
    g.fillStyle = "#f1efe6"; g.fillText("SCRUM", tx, top);
    g.fillStyle = "#e0b23c"; g.fillText("LINE", tx + g.measureText("SCRUM").width, top);
  }
  const th = h * .26, tw = th * 545 / 70, ty = top + wh + h * .12;
  if (art.tag) g.drawImage(art.tag, tx, ty, tw, th);
  else {
    g.font = `700 ${Math.round(th * .7)}px system-ui, sans-serif`; g.textBaseline = "top";
    drawTagline(g, tx, ty, "#f1efe6", "#e0b23c");
  }
  g.restore();
  return y + h;
}

/** The app header's ground: deep logo green fading to the dark of the app, with faint mown bands and a gold edge. */
export function drawGround(g: CanvasRenderingContext2D, W: number, H: number) {
  const grass = g.createLinearGradient(0, 0, 0, H);
  grass.addColorStop(0, "#0f3a26"); grass.addColorStop(.35, "#0b2219"); grass.addColorStop(1, "#0a130f");
  g.fillStyle = grass; g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 220) { g.fillStyle = "rgba(255,255,255,.022)"; g.fillRect(0, y, W, 110); }
  const glow = g.createRadialGradient(W * .25, 0, 40, W * .25, 0, W);
  glow.addColorStop(0, "rgba(224,178,60,.10)"); glow.addColorStop(1, "rgba(224,178,60,0)");
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  g.fillStyle = "#e0b23c"; g.fillRect(0, 0, W, 10);
}
