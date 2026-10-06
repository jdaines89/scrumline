"use client";

import { useEffect } from "react";

/** Old address for the Leagues screen: sends saved links and bookmarks to /leagues/. */
export default function OldLeaguesAddress() {
  useEffect(() => {
    window.location.replace(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/leagues/${window.location.search}${window.location.hash}`);
  }, []);
  return null;
}
