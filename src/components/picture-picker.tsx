"use client";

import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { clampOffset, shownSize, sourceRect, type Offset, type Size } from "@/lib/avatar-crop";

const FRAME = 220; // the round frame on screen
const OUT = 256;   // the saved picture, square, in pixels

/**
 * Choose a photo, drag it into place and slide to zoom: what's in the circle
 * is what everyone sees. The phone does the cropping and shrinking, so any
 * photo works, however big or sideways. Saving and removing are up to the caller.
 */
export function PicturePicker({ label, preview, has, onSave, onRemove, onMessage }: {
  label: string; preview: ReactNode; has: boolean;
  onSave: (jpeg: Blob) => Promise<void>; onRemove: () => Promise<void>;
  onMessage: (ok: boolean, text: string) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [img, setImg] = useState<{ el: HTMLImageElement; size: Size; url: string } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState<Offset>({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; start: Offset } | null>(null);

  function choose(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith("image/")) return onMessage(false, "That file isn't a photo.");
    const url = URL.createObjectURL(f);
    const el = new Image();
    el.onload = () => { setImg({ el, size: { w: el.naturalWidth, h: el.naturalHeight }, url }); setZoom(1); setOff({ x: 0, y: 0 }); };
    el.onerror = () => { URL.revokeObjectURL(url); onMessage(false, "Couldn't open that photo. Try another one."); };
    el.src = url;
  }

  function close() {
    if (img) URL.revokeObjectURL(img.url);
    setImg(null);
    if (file.current) file.current.value = "";
  }

  function down(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, start: off };
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !img) return;
    setOff(clampOffset({ x: d.start.x + e.clientX - d.x, y: d.start.y + e.clientY - d.y }, img.size, FRAME, zoom));
  }
  function up() { drag.current = null; }

  function rezoom(z: number) {
    if (!img) return;
    setZoom(z);
    setOff((o) => clampOffset(o, img.size, FRAME, z));
  }

  async function save() {
    if (!img) return;
    setBusy(true);
    try {
      const r = sourceRect(img.size, FRAME, zoom, off);
      const canvas = document.createElement("canvas");
      canvas.width = OUT; canvas.height = OUT;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img.el, r.x, r.y, r.side, r.side, 0, 0, OUT, OUT);
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.88));
      if (!blob) throw new Error("Couldn't prepare the picture.");
      await onSave(blob);
      close();
    } catch (e) {
      onMessage(false, e instanceof Error ? e.message : "Couldn't save the picture.");
    }
    setBusy(false);
  }

  async function remove() {
    setBusy(true);
    try { await onRemove(); } catch (e) { onMessage(false, e instanceof Error ? e.message : "Couldn't remove the picture."); }
    setBusy(false);
  }

  const shown = img ? shownSize(img.size, FRAME, zoom) : null;

  return (
    <div className="stack profile">
      <label className="small muted">{label}</label>
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => choose(e.target.files?.[0])} />

      {!img && (
        <div className="row avatar-row">
          {preview}
          <button type="button" onClick={() => file.current?.click()}>{has ? "Change picture" : "Add a picture"}</button>
          {has && <button type="button" className="ghost" disabled={busy} onClick={remove}>Remove</button>}
        </div>
      )}

      {img && shown && (
        <div className="cropper">
          <div className="crop-frame" style={{ width: FRAME, height: FRAME }}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            <img src={img.url} alt="Your new picture" draggable={false}
              style={{ width: shown.w, height: shown.h, transform: `translate(calc(-50% + ${off.x}px), calc(-50% + ${off.y}px))` }} />
          </div>
          <p className="small muted">Drag to move it. Slide to zoom.</p>
          <input type="range" min={1} max={3} step={0.01} value={zoom}
            aria-label="Zoom" onChange={(e) => rezoom(Number(e.target.value))} />
          <div className="row">
            <button type="button" className="ghost" disabled={busy} onClick={close}>Cancel</button>
            <button type="button" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save picture"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
