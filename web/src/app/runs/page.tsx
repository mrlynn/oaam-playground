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
import { listThreads } from "@/lib/queries";

export const metadata: Metadata = { title: "Runs · Memory Inspector" };

export default async function RunsPage() {
  const threads = await listThreads();

  return (
    <>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h1">Runs</Typography>
        <Typography variant="body2" color="text.secondary">
          One run per conversation thread. Open one to see its messages next to the memories it produced.
        </Typography>
      </Box>

      {threads.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: "center" }}>
          <Typography variant="h2" gutterBottom>
            No threads yet
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Seed some conversations: <code>cd agent &amp;&amp; uv run python scripts/seed.py</code>
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
