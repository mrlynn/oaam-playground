"use client";

import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Slider from "@mui/material/Slider";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

type Props = {
  turn: number;
  turnCount: number;
  /** The other query params to keep (view, expired), already encoded. */
  keep: string;
};

/**
 * Step through a run turn by turn. Writes ?turn=n (replace, no scroll) so the
 * page stays a server component and any turn is a shareable URL.
 */
export default function TurnScrubber({ turn, turnCount, keep }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(turn);
  const [shownTurn, setShownTurn] = useState(turn);
  const [pending, startTransition] = useTransition();

  // The server moved to a new turn (back button, a link): follow it.
  if (turn !== shownTurn) {
    setShownTurn(turn);
    setValue(turn);
  }

  const go = (n: number) => {
    const next = Math.min(Math.max(n, 1), turnCount);
    setValue(next);
    if (next === turn) return;
    const params = new URLSearchParams(keep);
    params.set("turn", String(next));
    startTransition(() => router.replace(`?${params}`, { scroll: false }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true], [role=slider]")) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowLeft") go(value - 1);
      if (e.key === "ArrowRight") go(value + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const marks = turnCount <= 40 ? Array.from({ length: turnCount }, (_, i) => ({ value: i + 1 })) : undefined;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, opacity: pending ? 0.7 : 1 }}>
      <IconButton aria-label="Previous turn" onClick={() => go(value - 1)} disabled={value <= 1} size="small">
        <ChevronLeftIcon />
      </IconButton>
      <Slider
        aria-label="Turn"
        value={value}
        min={1}
        max={Math.max(turnCount, 1)}
        step={1}
        marks={marks}
        valueLabelDisplay="auto"
        valueLabelFormat={(n) => `turn ${n}`}
        onChange={(_, n) => setValue(n as number)}
        onChangeCommitted={(_, n) => go(n as number)}
        disabled={turnCount < 2}
        sx={{ flex: 1, mx: 1 }}
      />
      <IconButton aria-label="Next turn" onClick={() => go(value + 1)} disabled={value >= turnCount} size="small">
        <ChevronRightIcon />
      </IconButton>
      <Typography variant="body2" sx={{ minWidth: 92, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        turn {value} / {turnCount}
      </Typography>
    </Box>
  );
}
