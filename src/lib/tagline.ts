/** The tagline as the logo sets it: chalk letters with OUR picked out in gold and underlined. Uses the canvas's current font. */
export function drawTagline(g: CanvasRenderingContext2D, x: number, y: number, chalk: string, gold: string) {
  const parts: [string, string][] = [["GET ", chalk], ["OUR", gold], [" SCHOOLS OVER THE LINE", chalk]];
  for (const [text, colour] of parts) {
    const w = g.measureText(text).width;
    g.fillStyle = colour; g.fillText(text, x, y);
    if (text === "OUR") { g.fillRect(x, y + 5, w - 2, 3); }
    x += w;
  }
}
