import Box from "@mui/material/Box";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  type Bar,
  COLLAPSED_DEPTH,
  endInferred,
  fmtSpanMs,
  parseTurnParam,
  producedBy,
  SHOW_ALL_UP_TO,
  stageTotals,
  waterfall,
} from "@/lib/lifecycle";
import { formatDateTime, shortId } from "@/lib/format";
import { getRun, getTurnEvents, getTurns } from "@/lib/queries";
import type { EventRow, Stage, TurnRow } from "@/lib/runTypes";
import { STAGE_COLOR, STAGE_ORDER } from "@/lib/stageColors";

export async function generateMetadata({ params }: PageProps<"/runs/[id]/turn/[n]">): Promise<Metadata> {
  const { id, n } = await params;
  return { title: `Turn ${n} of ${shortId(id)} · Lifecycle · Memory Inspector` };
}

export default async function LifecyclePage({ params, searchParams }: PageProps<"/runs/[id]/turn/[n]">) {
  const { id, n } = await params;
  const sp = await searchParams;
  const turnNo = parseTurnParam(n);
  if (turnNo === null) notFound();
  const [run, turns] = await Promise.all([getRun(id), getTurns(id)]);
  const turn = turns.find((t) => t.turn === turnNo);
  if (!run || !turn) notFound();
  const events = await getTurnEvents(id, turnNo);

  const showAll = sp.depth === "all" || events.length <= SHOW_ALL_UP_TO;
  const wf = waterfall(events, showAll ? Infinity : COLLAPSED_DEPTH);
  const totals = stageTotals(events, wf.totalMs);
  const hasPrev = turns.some((t) => t.turn === turnNo - 1);
  const hasNext = turns.some((t) => t.turn === turnNo + 1);
  const here = `/runs/${id}/turn/${turnNo}`;

  return (
    <>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link href="/runs">Runs</Link>
        <Link href={`/runs/${id}?turn=${turnNo}`}>{shortId(id)}</Link>
        <Typography color="text.primary">turn {turnNo} lifecycle</Typography>
      </Breadcrumbs>
      <Typography variant="h1" component="h1" sx={{ mb: 1 }}>
        Turn {turnNo}: what the memory package did
      </Typography>
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, alignItems: "center", mb: 2 }}>
        <Chip label={`${(wf.totalMs / 1000).toFixed(2)} s of package work`} />
        <Chip variant="outlined" label={`${events.length} spans`} />
        {turn.attrs?.closed_by ? <Chip variant="outlined" label={`closed by ${turn.attrs.closed_by}`} /> : null}
        <Typography variant="caption" color="text.secondary">
          started {formatDateTime(turn.started_at)}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        {hasPrev ? <Link href={`/runs/${id}/turn/${turnNo - 1}`}>← turn {turnNo - 1}</Link> : null}
        <Link href={`/runs/${id}?turn=${turnNo}`}>conversation at turn {turnNo}</Link>
        <Link href={`/runs/${id}?turn=${turnNo}&view=why`}>why</Link>
        {hasNext ? <Link href={`/runs/${id}/turn/${turnNo + 1}`}>turn {turnNo + 1} →</Link> : null}
      </Stack>

      {turn.user_message ? (
        <Typography variant="body2" sx={{ fontStyle: "italic", mb: 2, overflowWrap: "anywhere" }}>
          “{turn.user_message}”
        </Typography>
      ) : null}

      <Paper sx={{ p: 1.5, mb: 3 }}>
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1.5, mb: 1.5, alignItems: "center" }}>
          {STAGE_ORDER.filter((s) => totals.some((t) => t.stage === s)).map((s) => (
            <Stack key={s} direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: STAGE_COLOR[s] }} />
              <Typography variant="caption">{s}</Typography>
            </Stack>
          ))}
          <Box sx={{ flexGrow: 1 }} />
          {wf.hidden ? (
            <Link href={`${here}?depth=all`} scroll={false}>
              <Typography variant="caption">show {wf.hidden} deeper spans</Typography>
            </Link>
          ) : showAll && events.length > SHOW_ALL_UP_TO ? (
            <Link href={here} scroll={false}>
              <Typography variant="caption">show top levels only</Typography>
            </Link>
          ) : null}
        </Stack>
        {events.length === 0 ? (
          <Typography variant="body2" color="text.secondary">No events were recorded for this turn.</Typography>
        ) : (
          <Box role="list" aria-label="Spans in start order">
            {wf.bars.map((b) => (
              <SpanRow key={b.event_id} bar={b} />
            ))}
          </Box>
        )}
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.5, mb: 0 }}>
          Bars sit at their start offset and are as long as they took ({Math.round(wf.totalMs)} ms end to end). Dashed
          bars closed by inference: the package logged no end for them. The package&apos;s own LLM token spend
          (context summary, extraction) is not reported by the package, so it isn&apos;t shown here.
        </Typography>
      </Paper>

      <Typography variant="overline" color="text.secondary" component="h2">
        By stage
      </Typography>
      <Grid container spacing={2}>
        {totals.map((t) => (
          <Grid key={t.stage} size={{ xs: 12, sm: 6, lg: 4 }}>
            <StageCard stage={t.stage} ms={t.ms} share={t.share} spans={t.spans} turn={turn} events={events} />
          </Grid>
        ))}
      </Grid>
    </>
  );
}

function SpanRow({ bar: b }: { bar: Bar }) {
  const inferred = endInferred(b);
  const dur = fmtSpanMs(b.duration_ms);
  const label = `${b.name} · ${b.stage} · ${dur} · ${b.source === "wrapper" ? "agent call" : "package log"}${inferred ? " · end inferred" : ""}${b.error ? ` · error: ${b.error}` : ""}`;
  return (
    <Box
      role="listitem"
      title={label}
      sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(220px, 34%) 1fr" }, alignItems: "center", columnGap: 1.5, py: 0.25 }}
    >
      <Typography
        variant="caption"
        noWrap
        sx={{ pl: Math.min(b.depth, 6) * 1.25, fontWeight: b.source === "wrapper" ? 700 : 400, color: b.error ? "error.main" : "text.primary" }}
      >
        {b.name}
        <Box component="span" sx={{ color: "text.secondary", ml: 0.75 }}>
          {dur}
        </Box>
      </Typography>
      <Box sx={{ position: "relative", height: 14, bgcolor: "action.hover", borderRadius: 0.5 }}>
        <Box
          sx={{
            position: "absolute",
            top: 1,
            bottom: 1,
            left: `${b.leftPct}%`,
            width: `${b.widthPct}%`,
            bgcolor: inferred ? "transparent" : STAGE_COLOR[b.stage],
            border: inferred ? 2 : 0,
            borderStyle: "dashed",
            borderColor: STAGE_COLOR[b.stage],
            borderRadius: 0.5,
            opacity: b.depth >= 3 ? 0.6 : 1,
          }}
        />
      </Box>
    </Box>
  );
}

function StageCard({ stage, ms, share, spans, turn, events }: { stage: Stage; ms: number; share: number; spans: number; turn: TurnRow; events: EventRow[] }) {
  const produced = producedBy(stage, turn, events);
  return (
    <Paper sx={{ p: 1.5, height: "100%", borderTop: 4, borderColor: STAGE_COLOR[stage] }}>
      <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between", mb: 0.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{stage}</Typography>
        <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
          {ms} ms · {Math.round(share * 100)}%
        </Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0, mb: 1 }}>
        {spans} span{spans === 1 ? "" : "s"}; time counted once per outermost {stage} span
      </Typography>
      {produced.map((line, i) => (
        <Typography key={i} variant="body2" sx={{ overflowWrap: "anywhere", mb: 0.5 }}>
          {line}
        </Typography>
      ))}
    </Paper>
  );
}
