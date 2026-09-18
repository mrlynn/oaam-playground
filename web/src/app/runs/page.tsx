import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import Link from "next/link";

import CopyId from "@/components/CopyId";
import { formatDateTime } from "@/lib/format";
import { listRuns, listThreads } from "@/lib/queries";

export const metadata: Metadata = { title: "Runs · Memory Inspector" };

export default async function RunsPage() {
  const [threads, runs] = await Promise.all([listThreads(), listRuns()]);
  const runById = new Map(runs.map((r) => [r.run_id, r]));

  return (
    <>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h1">Runs</Typography>
        <Typography variant="body2" color="text.secondary">
          One run per conversation thread. Threads with a run log (turns) can be stepped through turn by turn, with a “why” for every reply.
        </Typography>
      </Box>

      {threads.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: "center" }}>
          <Typography variant="h2" gutterBottom>
            No threads yet
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Seed some conversations (<code>cd agent &amp;&amp; uv run python scripts/seed.py</code>) or talk to the
            companion (<code>cd companion &amp;&amp; uv run companion</code>).
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small" aria-label="Runs">
            <TableHead>
              <TableRow>
                <TableCell>Thread</TableCell>
                <TableCell>User</TableCell>
                <TableCell sx={{ display: { xs: "none", md: "table-cell" } }}>Agent</TableCell>
                <TableCell align="right">Messages</TableCell>
                <TableCell align="right">Memories</TableCell>
                <TableCell align="right" title="Turns recorded by memory-inspector; blank if the thread predates it">Turns</TableCell>
                <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}>Created</TableCell>
                <TableCell sx={{ display: { xs: "none", lg: "table-cell" } }}>Last activity</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {threads.map((t) => (
                <TableRow key={t.thread_id} hover>
                  <TableCell>
                    <Link href={`/runs/${t.thread_id}`} aria-label={`Open thread ${t.thread_id}`}>
                      <Box component="span" sx={{ color: "primary.main", fontWeight: 600 }}>
                        <CopyId id={t.thread_id} />
                      </Box>
                    </Link>
                  </TableCell>
                  <TableCell>{t.user_id ?? "—"}</TableCell>
                  <TableCell sx={{ display: { xs: "none", md: "table-cell" } }}>{t.agent_id ?? "—"}</TableCell>
                  <TableCell align="right">{t.message_count}</TableCell>
                  <TableCell align="right">{t.memory_count}</TableCell>
                  <TableCell align="right" title={runById.get(t.thread_id)?.source}>{runById.get(t.thread_id)?.turn_count ?? ""}</TableCell>
                  <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}>{formatDateTime(t.created_at)}</TableCell>
                  <TableCell sx={{ display: { xs: "none", lg: "table-cell" } }}>{formatDateTime(t.last_activity)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );
}
