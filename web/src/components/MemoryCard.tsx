import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import CopyId from "@/components/CopyId";
import HintChip from "@/components/HintChip";
import { formatDateTime } from "@/lib/format";
import { memoryTypeColor } from "@/lib/memoryTypes";
import type { MemoryRow } from "@/lib/queries";

export default function MemoryCard({ memory }: { memory: MemoryRow }) {
  const color = memoryTypeColor(memory.memory_type);
  const storedOn = memory.thread_id ? "thread" : "user";
  // The extractor labels a scope in metadata, but the row may be stored more
  // narrowly. Surface the mismatch; it decides what a thread delete takes with it.
  const labelMismatch =
    memory.extractor_scope != null && memory.thread_id != null && memory.extractor_scope !== "thread";

  return (
    <Paper
      id={`mem-${memory.memory_id}`}
      sx={{
        p: 1.5,
        borderLeft: 4,
        borderLeftColor: color,
        opacity: memory.is_expired ? 0.5 : 1,
        scrollMarginTop: 80,
        "&:target": { outline: 2, outlineColor: color, outlineOffset: 2 },
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5, mb: 1 }}>
        <Chip label={memory.memory_type} sx={{ bgcolor: color, color: "#fff", fontWeight: 600 }} />
        <Chip
          variant="outlined"
          label={memory.origin}
          title={memory.origin === "extracted" ? "Written by automatic extraction" : "Written by an explicit add_memory call"}
        />
        {memory.importance != null ? <Importance value={memory.importance} /> : null}
        {memory.is_expired ? <Chip label="expired" color="warning" variant="outlined" /> : null}
      </Stack>

      <Typography variant="body2" sx={{ mb: 1, overflowWrap: "anywhere" }}>
        {memory.content}
      </Typography>

      {memory.entities?.length ? (
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, mb: 1 }}>
          {memory.entities.map((e) => (
            <Chip key={e} label={e} variant="outlined" sx={{ fontSize: "0.7rem", height: 20 }} />
          ))}
        </Stack>
      ) : null}

      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, alignItems: "center" }}>
        <HintChip hint={memory.thread_id ? "THREAD_ID is set: deleting the thread deletes this memory" : "No THREAD_ID: survives thread deletion"} label={`stored on ${storedOn}`} color={storedOn === "thread" ? "default" : "primary"} variant="outlined" />
        {labelMismatch ? (
          <HintChip hint={`The extractor labelled this "${memory.extractor_scope}"-scoped, but it is stored on the thread.`} label={`labelled ${memory.extractor_scope}`} color="warning" variant="outlined" />
        ) : null}
        {memory.user_id ? <Chip label={`user ${memory.user_id}`} variant="outlined" /> : null}
        {memory.agent_id ? <Chip label={`agent ${memory.agent_id}`} variant="outlined" /> : null}
      </Stack>

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, mt: 1, color: "text.secondary", alignItems: "center" }}>
        <Typography variant="caption" title="Derived from timestamps: the number of thread messages that existed when this memory was written">
          after message #{memory.after_message_position} <em>(derived)</em>
        </Typography>
        <Typography variant="caption">{formatDateTime(memory.created_at)}</Typography>
        <CopyId id={memory.memory_id} />
      </Box>
    </Paper>
  );
}

function Importance({ value }: { value: number }) {
  const v = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <Box
      component="span"
      role="img"
      aria-label={`Importance ${value} of 5`}
      title={`Importance ${value}/5, as scored by the extractor`}
      sx={{ display: "inline-flex", gap: "3px", alignItems: "center" }}>
        {Array.from({ length: 5 }, (_, i) => (
          <Box
            key={i}
            component="span"
            sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: i < v ? "text.primary" : "action.disabled" }}
          />
        ))}
    </Box>
  );
}
