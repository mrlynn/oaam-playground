import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import Link from "next/link";

import HintChip from "@/components/HintChip";
import FindingCard, { SEVERITY_COLOR } from "@/components/health/FindingCard";
import { type SortKey, badgesByMemory, compareRuns, memoryStats, parseSort } from "@/lib/findings";
import { formatDateTime, shortId } from "@/lib/format";
import { memoryTypeColor } from "@/lib/memoryTypes";
import {
  type CheckRunRow,
  type FindingRow,
  getFindingStubs,
  getFindings,
  getLatestCheckRun,
  getMemoriesByIds,
  getMemoryOrigins,
  getPreviousCheckRun,
  getRetrievalStats,
  listAllMemories,
} from "@/lib/queries";

export const metadata: Metadata = { title: "Memory · Memory Inspector" };

const SEVERITIES = ["high", "medium", "low"] as const;

export default async function MemoriesPage({ searchParams }: PageProps<"/memories">) {
  const sp = await searchParams;
  const tab = sp.tab === "all" ? "all" : "findings";
  const run = await getLatestCheckRun();
  const findings = run ? await getFindings(run.check_run_id) : [];

  return (
    <>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h1">Memory</Typography>
        <Typography variant="body2" color="text.secondary">
          What the store holds, and what a health check found wrong with it.
        </Typography>
      </Box>
      <Stack direction="row" spacing={1} sx={{ mb: 2 }} role="tablist" aria-label="Memory views">
        <Tab href="/memories" active={tab === "findings"} label={`Findings${run ? ` · ${findings.length}` : ""}`} />
        <Tab href="/memories?tab=all" active={tab === "all"} label="All memories" />
      </Stack>
      {tab === "findings" ? (
        <FindingsTab run={run} findings={findings} />
      ) : (
        <AllMemories findings={findings} sort={parseSort(sp.sort)} includeExpired={sp.expired === "1"} />
      )}
    </>
  );
}

function Tab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href} role="tab" aria-selected={active}>
      <Chip clickable label={label} color={active ? "primary" : "default"} variant={active ? "filled" : "outlined"} />
    </Link>
  );
}

async function FindingsTab({ run, findings }: { run: CheckRunRow | null; findings: FindingRow[] }) {
  if (!run) {
    return (
      <Paper sx={{ p: 4, textAlign: "center" }}>
        <Typography variant="h2" gutterBottom>
          No health check yet
        </Typography>
        <Typography variant="body2" color="text.secondary" component="div">
          Run one against this schema: <code>cd agent &amp;&amp; uv run python scripts/check.py</code>, or{" "}
          <code>memory-inspector check --user … --dsn … --judge-model …</code> from any project.
        </Typography>
      </Paper>
    );
  }

  const previous = await getPreviousCheckRun(run);
  const comparison = compareRuns(findings, previous ? await getFindingStubs(previous.check_run_id) : null);
  const ids = [...new Set(findings.filter((f) => f.kind !== "orphan_chunks").flatMap((f) => (f.memory_ids ?? []).slice(0, 6)))];
  const [rows, origins] = await Promise.all([getMemoriesByIds(ids), getMemoryOrigins(ids)]);
  const memories = new Map(rows.map((m) => [m.memory_id, m]));
  const originOf = new Map(origins.map((o) => [o.memory_id, o]));
  const counts = run.counts ?? {};
  const newCount = [...comparison.status.values()].filter((s) => s === "new").length;

  return (
    <Stack spacing={2}>
      <Paper sx={{ p: 1.5 }}>
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Check #{run.check_run_id}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {formatDateTime(run.finished_at)} · {counts.memories ?? "?"} memories · {counts.candidate_pairs ?? "?"} close pairs
            {run.scope_user_id ? ` · user ${run.scope_user_id}` : ""}
          </Typography>
          <HintChip
            size="small"
            variant="outlined"
            label={run.judge_model ? `judge ${run.judge_model}` : "no judge"}
            hint={
              run.judge_model
                ? `Pairs and likely conversation-state memories were classified by ${run.judge_model}. Verdicts are cached by content; ${counts.judge_calls ?? 0} new calls, ${counts.judge_cache_hits ?? 0} cached this run.`
                : "Ran without an LLM judge: close pairs are unclassified unless one says it corrects the other, and transient memories are found by text pattern only."
            }
          />
          <Box sx={{ flexGrow: 1 }} />
          {comparison.compared ? (
            <Typography variant="body2" color="text.secondary">
              vs check #{previous!.check_run_id}: {newCount} new · {findings.length - newCount} still open · {comparison.resolved.length} resolved
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">
              first check with this scope and judge
            </Typography>
          )}
        </Stack>
      </Paper>

      {findings.length === 0 ? (
        <Paper sx={{ p: 3 }}>
          <Typography variant="body2">No findings. Nothing stale, duplicated or transient was found.</Typography>
        </Paper>
      ) : null}

      {SEVERITIES.map((sev) => {
        const group = findings.filter((f) => f.severity === sev);
        if (!group.length) return null;
        return (
          <Box key={sev} component="section" aria-labelledby={`sev-${sev}`}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
              <Chip size="small" color={SEVERITY_COLOR[sev]} label={sev} />
              <Typography id={`sev-${sev}`} variant="overline" color="text.secondary" component="h2">
                {group.length} finding{group.length === 1 ? "" : "s"}
              </Typography>
            </Stack>
            <Stack spacing={1.5}>
              {group.map((f) => (
                <FindingCard key={f.finding_id} finding={f} status={comparison.status.get(f.finding_id) ?? "open"} memories={memories} origins={originOf} />
              ))}
            </Stack>
          </Box>
        );
      })}

      {comparison.resolved.length ? (
        <Paper sx={{ p: 1.5 }}>
          <details>
            <summary style={{ cursor: "pointer" }}>
              <Typography variant="body2" component="span">
                Resolved since check #{previous!.check_run_id} · {comparison.resolved.length}
              </Typography>
            </summary>
            <Stack spacing={0.5} sx={{ mt: 1 }}>
              {comparison.resolved.map((r) => (
                <Typography key={r.fingerprint} variant="body2" sx={{ overflowWrap: "anywhere" }}>
                  <Chip size="small" color="success" variant="outlined" label="resolved" sx={{ mr: 1 }} />
                  {r.title}
                </Typography>
              ))}
            </Stack>
          </details>
        </Paper>
      ) : null}
    </Stack>
  );
}

async function AllMemories({ findings, sort, includeExpired }: { findings: FindingRow[]; sort: SortKey; includeExpired: boolean }) {
  const [memories, stats, origins] = await Promise.all([listAllMemories(includeExpired), getRetrievalStats(), getMemoryOrigins()]);
  const rows = memoryStats(memories, stats, origins, badgesByMemory(findings), sort);

  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {rows.length} memories. Retrieval counts cover instrumented turns only (agents wrapped with{" "}
        <code>inspect()</code>). Sorted by how often each memory came back from search, to show which earn their keep.
      </Typography>
      <TableContainer component={Paper}>
        <Table size="small" aria-label="All memories">
          <TableHead>
            <TableRow>
              <TableCell>Type</TableCell>
              <TableCell>Memory</TableCell>
              <TableCell sx={{ display: { xs: "none", md: "table-cell" } }}>User</TableCell>
              <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}><SortLink s="created" label="Created" current={sort} includeExpired={includeExpired} /></TableCell>
              <TableCell align="right"><SortLink s="retrieved" label="Retrieved" current={sort} includeExpired={includeExpired} /></TableCell>
              <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" } }} title="Times it went into the prompt (when the agent reported its prompt)">In prompt</TableCell>
              <TableCell><SortLink s="findings" label="Findings" current={sort} includeExpired={includeExpired} /></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((m) => (
              <TableRow key={m.memory_id} hover sx={{ opacity: m.is_expired ? 0.5 : 1 }}>
                <TableCell>
                  <Chip size="small" label={m.memory_type} sx={{ bgcolor: memoryTypeColor(m.memory_type), color: "#fff" }} />
                </TableCell>
                <TableCell sx={{ maxWidth: 520 }}>
                  <Typography variant="body2" title={m.content ?? ""} sx={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}>
                    {m.content}
                  </Typography>
                </TableCell>
                <TableCell sx={{ display: { xs: "none", md: "table-cell" } }}>{m.user_id ?? "—"}</TableCell>
                <TableCell sx={{ display: { xs: "none", sm: "table-cell" }, whiteSpace: "nowrap" }}>
                  <Typography variant="body2">{formatDateTime(m.created_at)}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {m.createdIn ? (
                      <Link href={`/runs/${m.createdIn.runId}?turn=${m.createdIn.turn}`}>
                        turn {m.createdIn.turn} of {shortId(m.createdIn.runId)}
                      </Link>
                    ) : m.thread_id ? (
                      <Link href={`/runs/${m.thread_id}`}>thread {shortId(m.thread_id)}</Link>
                    ) : (
                      "user level"
                    )}
                  </Typography>
                </TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{m.retrieved}</TableCell>
                <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" }, fontVariantNumeric: "tabular-nums" }}>{m.inPrompt}</TableCell>
                <TableCell>
                  <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5 }}>
                    {m.badges.map((b) => (
                      <Link key={`${b.findingId}-${b.label}`} href={`/memories#finding-${b.findingId}`}>
                        <HintChip size="small" clickable variant="outlined" color={b.kind === "superseded" || b.kind === "contradiction" ? "error" : "warning"} label={b.label} hint={b.hint} />
                      </Link>
                    ))}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}

function SortLink({ s, label, current, includeExpired }: { s: SortKey; label: string; current: SortKey; includeExpired: boolean }) {
  if (s === current) return <strong>{label} ↓</strong>;
  return <Link href={`/memories?tab=all&sort=${s}${includeExpired ? "&expired=1" : ""}`}>{label}</Link>;
}
