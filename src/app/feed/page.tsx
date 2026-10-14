"use client";

import { useState } from "react";
import { FeedTotals, OverTheLineHead, SchoolFeed } from "@/components/school-feed";
import { provinceName } from "@/lib/crest";

const CODES = ["EC", "FS", "GP", "KZN", "LP", "MP", "NC", "NW", "WC"];

/** Over the Line: projects at schools across the country, or in one province. */
export default function FeedPage() {
  const [province, setProvince] = useState("");
  return (
    <div className="card">
      <OverTheLineHead intro="Real projects at real schools: toilets, books, water, kit. Players and sponsors push each one forward, and every call you make helps carry it over the line." />
      <FeedTotals />
      <select aria-label="Province" value={province} onChange={(e) => setProvince(e.target.value)} style={{ marginBottom: 12 }}>
        <option value="">All provinces</option>
        {CODES.map((c) => <option key={c} value={c}>{provinceName(c)}</option>)}
      </select>
      <SchoolFeed province={province || undefined} filters />
    </div>
  );
}
