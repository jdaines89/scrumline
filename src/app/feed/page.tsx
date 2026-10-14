"use client";

import { useState } from "react";
import { FeedTotals, SchoolFeed } from "@/components/school-feed";
import { provinceName } from "@/lib/crest";

const CODES = ["EC", "FS", "GP", "KZN", "LP", "MP", "NC", "NW", "WC"];

/** Over the Line: projects at schools across the country, or in one province. */
export default function FeedPage() {
  const [province, setProvince] = useState("");
  return (
    <div className="card">
      <h2>Over the Line</h2>
      <p className="sub">Projects opening, getting backed and arriving at schools across South Africa.</p>
      <FeedTotals />
      <select aria-label="Province" value={province} onChange={(e) => setProvince(e.target.value)} style={{ marginBottom: 12 }}>
        <option value="">All provinces</option>
        {CODES.map((c) => <option key={c} value={c}>{provinceName(c)}</option>)}
      </select>
      <SchoolFeed province={province || undefined} filters />
    </div>
  );
}
