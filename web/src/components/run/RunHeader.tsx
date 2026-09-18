import Box from "@mui/material/Box";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";

import CopyId from "@/components/CopyId";
import { formatDateTime, shortId } from "@/lib/format";
import type { ThreadRow } from "@/lib/queries";
import type { RunRow } from "@/lib/runTypes";

type Props = {
  thread: ThreadRow;
  includeExpired: boolean;
  run?: RunRow | null;
  /** Toggle link for expired rows; defaults to flipping ?expired on the bare thread URL. */
  expiredHref?: string;
};

export default function RunHeader({ thread, includeExpired, run, expiredHref }: Props) {
  const id = thread.thread_id;
  const toggle = expiredHref ?? (includeExpired ? `/runs/${id}` : `/runs/${id}?expired=1`);
  return (
    <>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link href="/runs">Runs</Link>
        <Typography color="text.primary" sx={{ fontFamily: "var(--font-geist-mono), monospace" }}>
          {shortId(id)}
        </Typography>
      </Breadcrumbs>

      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, mb: 1 }}>
        <Typography variant="h1" component="h1">
          Thread <CopyId id={thread.thread_id} />
        </Typography>
      </Box>
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, mb: 2, alignItems: "center" }}>
        <Chip label={`user ${thread.user_id ?? "—"}`} />
        <Chip label={`agent ${thread.agent_id ?? "—"}`} />
        <Chip variant="outlined" label={`${thread.message_count} messages`} />
        <Chip variant="outlined" label={`${thread.memory_count} memories`} />
        {run ? (
          <Chip
            variant="outlined"
            color="primary"
            label={`${run.turn_count} turns · ${run.source}`}
            title={[run.llm_model, run.embed_model, run.package_version && `oracleagentmemory ${run.package_version}`].filter(Boolean).join(" · ")}
          />
        ) : null}
        <Typography variant="caption" color="text.secondary">
          created {formatDateTime(thread.created_at)} · last activity {formatDateTime(thread.last_activity)}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Link href={toggle} scroll={false}>
          <Chip
            clickable
            variant={includeExpired ? "filled" : "outlined"}
            color={includeExpired ? "warning" : "default"}
            label={includeExpired ? "Showing expired rows" : "Show expired rows"}
          />
        </Link>
      </Stack>
    </>
  );
}
