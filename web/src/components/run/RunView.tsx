import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";

import MessageBubble from "@/components/MessageBubble";
import MemoryStateCard from "@/components/run/MemoryStateCard";
import RunHeader from "@/components/run/RunHeader";
import TurnScrubber from "@/components/run/TurnScrubber";
import WhyPanel, { type WhyRow } from "@/components/run/WhyPanel";
import type { MemoryAt } from "@/lib/memoryState";
import type { MessageRow, ThreadRow } from "@/lib/queries";
import type { RunRow, TurnPrompt, TurnRow } from "@/lib/runTypes";

export type RunViewProps = {
  thread: ThreadRow;
  run: RunRow;
  turns: TurnRow[];
  turn: number;
  view: "memory" | "why";
  includeExpired: boolean;
  messages: MessageRow[];
  messageTurns: Map<string, number>;
  state: MemoryAt[];
  whyRows: WhyRow[];
  prompt: TurnPrompt | null;
};

/** A thread with a run log: the scrubber, the conversation as of turn n, and memory or "why" on the right. */
export default function RunView(p: RunViewProps) {
  const { thread, run, turns, turn, view, includeExpired } = p;
  const id = thread.thread_id;
  const current = turns.find((t) => t.turn === turn)!;

  const href = (params: { turn?: number; view?: "memory" | "why"; expired?: boolean }) => {
    const q = new URLSearchParams();
    q.set("turn", String(params.turn ?? turn));
    if ((params.view ?? view) === "why") q.set("view", "why");
    if (params.expired ?? includeExpired) q.set("expired", "1");
    return `/runs/${id}?${q}`;
  };
  const turnHref = (n: number) => href({ turn: n });
  const keep = new URLSearchParams({ ...(view === "why" ? { view: "why" } : {}), ...(includeExpired ? { expired: "1" } : {}) }).toString();

  const live = p.state.filter((m) => m.removedTurn === null);
  const removed = p.state.filter((m) => m.removedTurn !== null);
  const diff = current.memory_diff;

  return (
    <>
      <RunHeader thread={thread} run={run} includeExpired={includeExpired} expiredHref={href({ expired: !includeExpired })} />

      <Paper sx={{ p: 1.5, mb: 3, position: { md: "sticky" }, top: { md: 64 }, zIndex: 2 }}>
        <TurnScrubber turn={turn} turnCount={turns.length} keep={keep} />
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, mt: 1, alignItems: "center" }}>
          <Chip size="small" label={`${countOf(diff, "created")} created`} color={countOf(diff, "created") ? "success" : "default"} variant="outlined" />
          <Chip size="small" label={`${countOf(diff, "updated")} updated`} color={countOf(diff, "updated") ? "warning" : "default"} variant="outlined" />
          <Chip size="small" label={`${countOf(diff, "deleted")} deleted`} color={countOf(diff, "deleted") ? "error" : "default"} variant="outlined" />
          <Chip size="small" label={`${(current.retrieved ?? []).length} retrieved`} variant="outlined" />
          {current.prompt_tokens != null ? (
            <Chip
              size="small"
              variant="outlined"
              label={`prompt ${current.prompt_tokens} tok${current.flat_history_tokens != null ? ` · flat ${current.flat_history_tokens}` : ""}`}
              title="Tokens sent with memory (scoped) vs what the whole thread's history would cost (flat). See docs/token-method.md."
            />
          ) : null}
          <Typography variant="caption" color="text.secondary">
            {current.duration_ms != null ? `${(current.duration_ms / 1000).toFixed(1)}s` : ""}
            {current.attrs?.closed_by ? ` · closed by ${current.attrs.closed_by}` : ""}
            {current.reply_source === "scripted" ? " · scripted reply" : ""}
          </Typography>
        </Stack>
      </Paper>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Typography variant="overline" color="text.secondary" component="h2">
            Conversation
          </Typography>
          <Stack spacing={1.25}>
            {p.messages.map((m) => {
              const t = p.messageTurns.get(m.message_id);
              return (
                <MessageBubble
                  key={m.message_id}
                  message={m}
                  turn={t}
                  later={t != null && t > turn}
                  current={t === turn}
                  whyHref={t != null && m.role === "assistant" ? href({ turn: t, view: "why" }) : undefined}
                />
              );
            })}
            {p.messages.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No messages{includeExpired ? "" : " (expired rows hidden)"}.
              </Typography>
            ) : null}
          </Stack>
        </Grid>

        {/* On phones the "why" pane comes first, so tapping "why?" shows something. */}
        <Grid size={{ xs: 12, md: 5 }} sx={{ order: { xs: view === "why" ? -1 : 0, md: 0 } }}>
          <Box sx={{ position: { md: "sticky" }, top: { md: 190 }, maxHeight: { md: "calc(100vh - 210px)" }, overflowY: { md: "auto" }, pr: { md: 0.5 } }}>
            <Stack direction="row" spacing={1} sx={{ mb: 1.5 }} role="tablist" aria-label="Right pane">
              <PaneTab href={href({ view: "memory" })} active={view === "memory"} label={`Memory at turn ${turn}`} />
              <PaneTab href={href({ view: "why" })} active={view === "why"} label={`Why (turn ${turn})`} />
            </Stack>

            {view === "why" ? (
              <WhyPanel runId={id} turn={current} rows={p.whyRows} prompt={p.prompt} turnHref={(n) => href({ turn: n, view: "why" })} />
            ) : (
              <Stack spacing={1.25}>
                {live.map((m) => (
                  <MemoryStateCard key={m.id} memory={m} turn={turn} turnHref={turnHref} />
                ))}
                {live.length === 0 ? (
                  <Paper sx={{ p: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                      No durable memories yet at turn {turn}.
                    </Typography>
                  </Paper>
                ) : null}
                {removed.length ? (
                  <>
                    <Typography variant="overline" color="text.secondary" component="h3" sx={{ pt: 1 }}>
                      Removed · {removed.length}
                    </Typography>
                    {removed.map((m) => (
                      <MemoryStateCard key={m.id} memory={m} turn={turn} turnHref={turnHref} />
                    ))}
                  </>
                ) : null}
              </Stack>
            )}
          </Box>
        </Grid>
      </Grid>
    </>
  );
}

function PaneTab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href} scroll={false} role="tab" aria-selected={active}>
      <Chip clickable label={label} color={active ? "primary" : "default"} variant={active ? "filled" : "outlined"} />
    </Link>
  );
}

function countOf(diff: TurnRow["memory_diff"], key: "created" | "updated" | "deleted"): number {
  return diff?.[key]?.length ?? 0;
}
