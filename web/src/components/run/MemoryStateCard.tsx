import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";

import HintChip from "@/components/HintChip";
import type { MemoryAt } from "@/lib/memoryState";
import { promptLabel } from "@/lib/memoryState";
import { memoryTypeColor } from "@/lib/memoryTypes";

type Props = {
  memory: MemoryAt;
  turn: number;
  /** Builds a link to another turn of this run, keeping the other params. */
  turnHref: (n: number) => string;
};

/** One durable memory as it was at the scrubbed turn. */
export default function MemoryStateCard({ memory: m, turn, turnHref }: Props) {
  const color = memoryTypeColor(m.type);
  const removed = m.removedTurn !== null;
  const lastRevision = m.revisions.at(-1);
  const row = m.row;
  const labelMismatch = row?.extractor_scope != null && row.thread_id != null && row.extractor_scope !== "thread";

  return (
    <Paper
      id={`mem-${m.id}`}
      sx={{
        p: 1.5,
        borderLeft: 4,
        borderLeftColor: color,
        opacity: removed && !m.removedNow ? 0.45 : 1,
        outline: m.retrieval ? 2 : 0,
        outlineColor: "primary.main",
        outlineOffset: -1,
        bgcolor: m.newNow ? "action.hover" : "background.paper",
        transition: "opacity 150ms, background-color 150ms",
        scrollMarginTop: 80,
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5, mb: 1 }}>
        <Chip label={m.type} sx={{ bgcolor: color, color: "#fff", fontWeight: 600 }} />
        {m.newNow ? <Chip label={`created turn ${turn}`} color="success" /> : null}
        {m.retrieval ? (
          <HintChip
            color="primary"
            label={`retrieved #${m.retrieval.rank} · ${fmtDistance(m.retrieval.distance)}`}
            hint={`Search ${m.retrieval.search} this turn ranked it #${m.retrieval.rank} at distance ${fmtDistance(m.retrieval.distance)} (lower is closer). ${promptLabel(m.retrieval)}.`}
          />
        ) : null}
        {m.retrieval ? <Chip variant="outlined" label={promptLabel(m.retrieval)} /> : null}
        {m.revisedNow ? <Chip color="warning" label={`revised turn ${turn}`} /> : null}
        {removed ? <Chip color="error" variant={m.removedNow ? "filled" : "outlined"} label={`removed turn ${m.removedTurn}`} /> : null}
      </Stack>

      {m.revisedNow && lastRevision ? (
        <Typography variant="body2" sx={{ mb: 0.5, overflowWrap: "anywhere", color: "text.secondary", textDecoration: "line-through" }}>
          {lastRevision.before}
        </Typography>
      ) : null}
      <Typography
        variant="body2"
        sx={{ mb: 1, overflowWrap: "anywhere", textDecoration: removed ? "line-through" : "none" }}
      >
        {m.content}
      </Typography>

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.25, alignItems: "center", color: "text.secondary" }}>
        <Typography variant="caption">
          {m.createdTurn === null ? (
            "existed before the run log"
          ) : m.createdTurn === turn ? (
            `created this turn`
          ) : (
            <>
              created <Link href={turnHref(m.createdTurn)} scroll={false}>turn {m.createdTurn}</Link>
            </>
          )}
          {m.revisions.length && !m.revisedNow ? (
            <>
              {" · revised "}
              {m.revisions.map((r, i) => (
                <span key={r.turn}>
                  {i ? ", " : ""}
                  <Link href={turnHref(r.turn)} scroll={false}>turn {r.turn}</Link>
                </span>
              ))}
            </>
          ) : null}
        </Typography>
        {labelMismatch ? (
          <HintChip
            size="small"
            variant="outlined"
            color="warning"
            label={`labelled ${row!.extractor_scope}`}
            hint={`The extractor labelled this "${row!.extractor_scope}"-scoped, but it is stored on the thread: deleting the thread deletes it.`}
          />
        ) : null}
        {!removed && !row ? <Typography variant="caption">(no longer in the table)</Typography> : null}
      </Box>
    </Paper>
  );
}

export function fmtDistance(d: number | null | undefined): string {
  return d == null ? "—" : d.toFixed(3);
}
