import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";

import { type FindingStatus, KIND_LABEL, crowdedLabel, evidenceLines, memoryRole, methodLabel } from "@/lib/findings";
import { shortId } from "@/lib/format";
import { memoryTypeColor } from "@/lib/memoryTypes";
import type { MemoryRow } from "@/lib/queries";
import type { FindingRow, MemoryOrigin } from "@/lib/runTypes";

export const SEVERITY_COLOR = { high: "error", medium: "warning", low: "default" } as const;

const MAX_MEMORIES = 6;

type Props = {
  finding: FindingRow;
  status: FindingStatus;
  memories: Map<string, MemoryRow>;
  origins: Map<string, MemoryOrigin>;
};

/** One health finding: what is wrong, the evidence, and the fix. */
export default function FindingCard({ finding: f, status, memories, origins }: Props) {
  const ids = f.kind === "orphan_chunks" ? [] : (f.memory_ids ?? []);

  return (
    <Paper id={`finding-${f.finding_id}`} sx={{ p: 2, scrollMarginTop: 80, "&:target": { outline: 2, outlineColor: "primary.main" } }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5, mb: 1 }}>
        <Chip size="small" color={SEVERITY_COLOR[f.severity]} label={f.severity} />
        <Chip size="small" variant="outlined" label={KIND_LABEL[f.kind]} />
        {status === "new" ? <Chip size="small" color="primary" label="new" /> : null}
        {f.user_id ? <Chip size="small" variant="outlined" label={`user ${f.user_id}`} /> : null}
        <Typography variant="caption" color="text.secondary" title="How this finding was decided">
          decided by {methodLabel(f.method)}
        </Typography>
      </Stack>

      <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, mb: 0.5, overflowWrap: "anywhere" }}>
        {f.title}
      </Typography>
      {f.detail ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25, overflowWrap: "anywhere" }}>
          {f.detail}
        </Typography>
      ) : null}

      {ids.length ? (
        <Stack spacing={0.75} sx={{ mb: 1.25 }}>
          {ids.slice(0, MAX_MEMORIES).map((id) => {
            const m = memories.get(id);
            const o = origins.get(id);
            const r = memoryRole(f, id);
            const wasted = crowdedLabel(f, id);
            return (
              <Box key={id} sx={{ pl: 1.25, borderLeft: 3, borderColor: m ? memoryTypeColor(m.memory_type) : "divider" }}>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5 }}>
                  {m ? <Chip size="small" label={m.memory_type} sx={{ bgcolor: memoryTypeColor(m.memory_type), color: "#fff" }} /> : null}
                  {r ? <Chip size="small" variant="outlined" color={r === "stale" ? "error" : "success"} label={r} /> : null}
                  {wasted ? <Chip size="small" variant="outlined" color="warning" label={wasted} /> : null}
                  <Typography variant="caption" color="text.secondary">
                    {o ? (
                      <Link href={`/runs/${o.run_id}?turn=${o.turn}`}>
                        created turn {o.turn} of {shortId(o.run_id)}
                      </Link>
                    ) : m ? "created before the run log" : "deleted since this check"}
                  </Typography>
                </Stack>
                <Typography variant="body2" sx={{ overflowWrap: "anywhere", textDecoration: m ? "none" : "line-through" }}>
                  {m?.content ?? id}
                </Typography>
              </Box>
            );
          })}
          {ids.length > MAX_MEMORIES ? (
            <Typography variant="caption" color="text.secondary">
              and {ids.length - MAX_MEMORIES} more
            </Typography>
          ) : null}
        </Stack>
      ) : null}

      {f.turns?.length ? (
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 0.5, mb: 1.25, alignItems: "center" }}>
          <Typography variant="caption" color="text.secondary">
            see why:
          </Typography>
          {f.turns.map((t) => (
            <Link key={`${t.run_id}-${t.turn}`} href={`/runs/${t.run_id}?turn=${t.turn}&view=why`}>
              <Chip size="small" clickable variant="outlined" color="primary" label={`turn ${t.turn} of ${shortId(t.run_id)}`} />
            </Link>
          ))}
        </Stack>
      ) : null}

      <Evidence finding={f} />

      {f.suggestion ? (
        <Box sx={{ mt: 1.25 }}>
          <Typography variant="caption" color="text.secondary">
            suggested fix
          </Typography>
          <Box
            component="pre"
            sx={{ m: 0, mt: 0.5, p: 1.25, borderRadius: 1, bgcolor: "action.hover", fontSize: "0.78rem", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "var(--font-geist-mono), monospace" }}
          >
            {f.suggestion}
          </Box>
        </Box>
      ) : null}
    </Paper>
  );
}

/** Distances, patterns and judge rationales, labelled for what they are. */
function Evidence({ finding: f }: { finding: FindingRow }) {
  const lines = evidenceLines(f);
  if (!lines.length) return null;
  return (
    <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: { xs: "1fr", sm: "max-content 1fr" }, columnGap: 1.5, rowGap: 0.25 }}>
      {lines.map((l, i) => (
        <Box key={i} sx={{ display: "contents" }}>
          <Typography component="dt" variant="caption" color="text.secondary">
            {l.label}
          </Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0, mb: { xs: 0.5, sm: 0 }, overflowWrap: "anywhere" }}>
            {l.text}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
