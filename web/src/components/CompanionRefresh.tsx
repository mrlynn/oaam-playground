"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// The floating chat (the companion's /chat/widget.js) fires "companion:remembered" when a
// turn's memories are written. Re-render this page's server data so they show up next to it.
export default function CompanionRefresh() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => router.refresh();
    window.addEventListener("companion:remembered", refresh);
    return () => window.removeEventListener("companion:remembered", refresh);
  }, [router]);
  return null;
}
