import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";

import HintChip from "@/components/HintChip";
import { type PromptLabel, promptLabel } from "@/lib/memoryState";
import { memoryTypeColor } from "@/lib/memoryTypes";
import type { Retrieval, TurnPrompt, TurnRow } from "@/lib/runTypes";
import { fmtDistance, shortId } from "@/lib/format";
import { type WhyRow, whySummary } from "@/lib/why";

export type { WhyRow };

type Props = {
  runId: string;
  turn: TurnRow;
  rows: WhyRow[];
  prompt: TurnPrompt | null;
  turnHref: (n: number) => string;
};

const LABEL_COLOR: Record<PromptLabel, "primary" | "default"> = {
  "in prompt": "primary",
  "also returned": "default",
  "returned by search": "default",
};

/** What turn n's reply was built from: every search result, ranked, and where each came from. */
export default function WhyPanel({ runId, turn, rows, prompt, turnHref }: Props) {
  const queries = turn.attrs?.queries ?? [];
  const searches = [...new Set(rows.map((r) => r.search))].sort((a, b) => a - b);
  const maxDistance = Math.max(0.0001, ...rows.map((r) => r.distance ?? 0));

  return (
    <Stack spacing={1.5}>
      <Paper sx={{ p: 1.5 }}>
        <Typography variant="overline" color="text.secondary">
          Why turn {turn.turn} replied the way it did
        </Typography>
        {turn.user_message ? (
          <Typography variant="body2" sx={{ fontStyle: "italic", mb: 1, overflowWrap: "anywhere" }}>
            “{turn.user_message}”
          </Typography>
        ) : null}
        <Typography variant="body2" color="text.secondary">
          {whySummary(rows)}
        </Typography>
      </Paper>

      {searches.map((s) => (
        <Box key={s}>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.75, overflowWrap: "anywhere" }}>
            search {s}
            {queries[s - 1] ? <> · “{queries[s - 1]}”</> : null} · distance, lower is closer
          </Typography>
          <Stack spacing={1}>
            {rows.filter((r) => r.search === s).map((r) => (
              <WhyResult key={`${s}-${r.rank}`} runId={runId} row={r} maxDistance={maxDistance} turnHref={turnHref} />
            ))}
          </Stack>
        </Box>
      ))}

      {prompt?.assembled_prompt ? (
        <Paper sx={{ p: 1.5 }}>
          <details>
            <summary style={{ cursor: "pointer" }}>
              <Typography variant="body2" component="span">
                Prompt the model saw
                {turn.prompt_tokens != null ? ` · ${turn.prompt_tokens} tokens` : ""}
                {turn.flat_history_tokens != null ? ` (flat history would be ${turn.flat_history_tokens})` : ""}
                {turn.reply_source === "scripted" ? " · reply was scripted" : ""}
              </Typography>
            </summary>
            <Box
              component="pre"
              sx={{ mt: 1, mb: 0, p: 1, fontSize: "0.75rem", whiteSpace: "pre-wrap", overflowWrap: "anywhere", bgcolor: "action.hover", borderRadius: 1, maxHeight: 420, overflowY: "auto" }}
            >
              {prompt.assembled_prompt}
            </Box>
          </details>
        </Paper>
      ) : null}
    </Stack>
  );
}

function WhyResult({ runId, row: r, maxDistance, turnHref }: { runId: string; row: WhyRow; maxDistance: number; turnHref: (n: number) => string }) {
  const label = promptLabel(r);
  const type = r.record_type ?? "unknown";
  const isMessage = type === "message";
  return (
    <Paper
      sx={{
        p: 1.25,
        borderLeft: 4,
        borderLeftColor: isMessage ? "divider" : memoryTypeColor(type),
        opacity: label === "in prompt" || !reportedFor(r) ? 1 : 0.7,
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5, mb: 0.75 }}>
        <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 28, fontVariantNumeric: "tabular-nums" }}>
          #{r.rank}
        </Typography>
        <Chip
          label={type}
          size="small"
          sx={isMessage ? undefined : { bgcolor: memoryTypeColor(type), color: "#fff", fontWeight: 600 }}
          variant={isMessage ? "outlined" : "filled"}
        />
        <DistanceBar distance={r.distance} max={maxDistance} />
        <Chip size="small" color={LABEL_COLOR[label]} variant={label === "in prompt" ? "filled" : "outlined"} label={label} />
        {isMessage ? (
          <HintChip size="small" variant="outlined" color="warning" label="raw message" hint="A raw message chunk, not a durable memory. Searches without record_types rank messages and memories together." />
        ) : null}
        {r.badges.map((b) => (
          <Link key={`${b.findingId}-${b.label}`} href={`/memories#finding-${b.findingId}`}>
            <HintChip size="small" clickable color={b.kind === "superseded" || b.kind === "contradiction" ? "error" : "warning"} label={b.label} hint={`Health check: ${b.hint}`} />
          </Link>
        ))}
      </Stack>
      <Typography variant="body2" sx={{ overflowWrap: "anywhere", mb: 0.5, textDecoration: r.gone ? "line-through" : "none" }}>
        {r.content ?? <em>(content not available)</em>}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        <Origin runId={runId} row={r} turnHref={turnHref} />
        {r.gone ? " · since deleted" : ""}
      </Typography>
    </Paper>
  );
}

function reportedFor(r: Retrieval): boolean {
  return r.in_prompt !== null;
}

function Origin({ runId, row: r, turnHref }: { runId: string; row: WhyRow; turnHref: (n: number) => string }) {
  if (r.origin?.runId === runId) {
    return (
      <>
        created at <Link href={turnHref(r.origin.turn)} scroll={false}>turn {r.origin.turn}</Link> of this conversation
      </>
    );
  }
  if (r.origin) {
    return (
      <>
        created in an earlier conversation:{" "}
        <Link href={`/runs/${r.origin.runId}?turn=${r.origin.turn}`}>
          {shortId(r.origin.runId)}, turn {r.origin.turn}
        </Link>
      </>
    );
  }
  if (r.storedThread && r.storedThread !== runId) {
    return (
      <>
        stored on thread <Link href={`/runs/${r.storedThread}`}>{shortId(r.storedThread)}</Link>, before the run log
      </>
    );
  }
  return <>created before the run log</>;
}

function DistanceBar({ distance, max }: { distance: number | null; max: number }) {
  const pct = distance == null ? 0 : Math.max(4, Math.round((1 - distance / (max * 1.05)) * 100));
  return (
    <Box
      sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}
      title={`distance ${fmtDistance(distance)}, as returned by search (lower is closer); the package does not store it`}
    >
      <Box sx={{ width: 56, height: 6, borderRadius: 3, bgcolor: "action.disabledBackground", overflow: "hidden" }}>
        <Box sx={{ width: `${pct}%`, height: "100%", bgcolor: "primary.main" }} />
      </Box>
      <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>
        {fmtDistance(distance)}
      </Typography>
    </Box>
  );
}
