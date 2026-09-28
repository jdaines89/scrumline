"use client";

import { setPreview, usePreview } from "@/lib/preview";

/** A reminder, on every screen, that the sponsor bits are sample data. */
export function PreviewBar() {
  const on = usePreview();
  if (!on) return null;
  return (
    <div className="preview-bar">
      <span>Sample sponsor data. Only you see this, on this device.</span>
      <button type="button" className="linkish" onClick={() => setPreview(false)}>Turn off</button>
    </div>
  );
}
