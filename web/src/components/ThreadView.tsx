import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { Fragment } from "react";

import MemoryCard from "@/components/MemoryCard";
import MessageBubble from "@/components/MessageBubble";
import RunHeader from "@/components/run/RunHeader";
import { memoryTypeColor } from "@/lib/memoryTypes";
import type { MemoryRow, MessageRow, ThreadRow } from "@/lib/queries";

/**
 * A thread with no run log: messages and the memories stored on it, placed by
 * derived position. Runs recorded by memory-inspector get RunView instead.
 */
export default function ThreadView({ thread, messages, memories, includeExpired }: {
  thread: ThreadRow;
  messages: MessageRow[];
  memories: MemoryRow[];
  includeExpired: boolean;
}) {
  const id = thread.thread_id;

  const threadMemories = memories.filter((m) => m.thread_id === id);
  const userLevel = memories.filter((m) => m.thread_id == null);
  const byPosition = groupBy(threadMemories, (m) => m.after_message_position);

  return (
    <>
      <RunHeader thread={thread} includeExpired={includeExpired} />

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
