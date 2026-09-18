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
import { Fragment } from "react";

import CopyId from "@/components/CopyId";
import MemoryCard from "@/components/MemoryCard";
import MessageBubble from "@/components/MessageBubble";
import { formatDateTime, shortId } from "@/lib/format";
import { memoryTypeColor } from "@/lib/memoryTypes";
import { type MemoryRow, getMessages, getThread, getThreadMemories } from "@/lib/queries";

export async function generateMetadata({ params }: PageProps<"/runs/[id]">): Promise<Metadata> {
  const { id } = await params;
  return { title: `Run ${shortId(id)} · Memory Inspector` };
}

export default async function RunPage({ params, searchParams }: PageProps<"/runs/[id]">) {
  const { id } = await params;
  const { expired } = await searchParams;
  const includeExpired = expired === "1";

  const thread = await getThread(id);
  if (!thread) notFound();

  const [messages, memories] = await Promise.all([
    getMessages(id, includeExpired),
    getThreadMemories(id, thread.user_id, includeExpired),
  ]);

  const threadMemories = memories.filter((m) => m.thread_id === id);
  const userLevel = memories.filter((m) => m.thread_id == null);
  const byPosition = groupBy(threadMemories, (m) => m.after_message_position);

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
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, mb: 3, alignItems: "center" }}>
        <Chip label={`user ${thread.user_id ?? "—"}`} />
        <Chip label={`agent ${thread.agent_id ?? "—"}`} />
        <Chip variant="outlined" label={`${thread.message_count} messages`} />
        <Chip variant="outlined" label={`${thread.memory_count} memories`} />
        <Typography variant="caption" color="text.secondary">
          created {formatDateTime(thread.created_at)} · last activity {formatDateTime(thread.last_activity)}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Link href={includeExpired ? `/runs/${id}` : `/runs/${id}?expired=1`} scroll={false}>
          <Chip
            clickable
            variant={includeExpired ? "filled" : "outlined"}
            color={includeExpired ? "warning" : "default"}
            label={includeExpired ? "Showing expired rows" : "Show expired rows"}
          />
        </Link>
      </Stack>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Typography variant="overline" color="text.secondary" component="h2">
            Conversation
          </Typography>
          <Stack spacing={1.25}>
            {byPosition.get(0) ? <MemoryMarker memories={byPosition.get(0)!} /> : null}
            {messages.map((m) => (
              <Fragment key={m.message_id}>
                <MessageBubble message={m} />
                {byPosition.get(m.position) ? <MemoryMarker memories={byPosition.get(m.position)!} /> : null}
              </Fragment>
            ))}
            {messages.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No messages{includeExpired ? "" : " (expired rows hidden)"}.
              </Typography>
            ) : null}
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Box sx={{ position: { md: "sticky" }, top: { md: 80 }, maxHeight: { md: "calc(100vh - 100px)" }, overflowY: { md: "auto" }, pr: { md: 0.5 } }}>
            <Typography variant="overline" color="text.secondary" component="h2">
              Durable memories · {threadMemories.length}
            </Typography>
            <Stack spacing={1.25}>
              {threadMemories.map((m) => (
                <MemoryCard key={m.memory_id} memory={m} />
              ))}
              {threadMemories.length === 0 ? (
                <Paper sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    No memories stored on this thread.
                  </Typography>
                </Paper>
              ) : null}
            </Stack>

            {userLevel.length ? (
              <>
                <Typography variant="overline" color="text.secondary" component="h2" sx={{ display: "block", mt: 3 }}>
                  User-level memories for {thread.user_id} · {userLevel.length}
                </Typography>
                <Stack spacing={1.25}>
                  {userLevel.map((m) => (
                    <MemoryCard key={m.memory_id} memory={m} />
                  ))}
                </Stack>
              </>
            ) : null}
          </Box>
        </Grid>
      </Grid>
    </>
  );
}

/** Inline marker in the conversation: memories whose derived position is here. */
function MemoryMarker({ memories }: { memories: MemoryRow[] }) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 0.75,
        pl: 1.5,
        py: 0.5,
        borderLeft: 2,
        borderColor: "primary.main",
        color: "text.secondary",
      }}
    >
      <Typography variant="caption">
        {memories.length} {memories.length === 1 ? "memory" : "memories"} written here (derived)
      </Typography>
      {memories.map((m) => (
        <a key={m.memory_id} href={`#mem-${m.memory_id}`} aria-label={`${m.memory_type}: ${m.content ?? ""}`} title={m.content ?? ""}>
          <Box component="span" sx={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", bgcolor: memoryTypeColor(m.memory_type) }} />
        </a>
      ))}
    </Box>
  );
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return map;
}
