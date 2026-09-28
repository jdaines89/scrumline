/**
 * Fits a logo, whole, into a 256 x 256 transparent PNG: nothing is cropped,
 * so a wide wordmark stays readable with space above and below.
 */
export async function squareLogo(file: File, side = 256): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error("That file isn't a picture we can read.")); i.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = side; canvas.height = side;
    const s = Math.min(side / img.naturalWidth, side / img.naturalHeight);
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    canvas.getContext("2d")!.drawImage(img, (side - w) / 2, (side - h) / 2, w, h);
    return await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't read that picture."))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}
