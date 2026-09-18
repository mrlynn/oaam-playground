import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";

import { formatDateTime } from "@/lib/format";
import type { MessageRow } from "@/lib/queries";

export default function MessageBubble({ message }: { message: MessageRow }) {
  const isUser = message.role === "user";
  return (
    <Box
      id={`msg-${message.position}`}
      sx={{
        display: "flex",
        justifyContent: isUser ? "flex-start" : "flex-end",
        opacity: message.is_expired ? 0.5 : 1,
      }}
    >
      <Box
        sx={{
          maxWidth: { xs: "92%", sm: "80%" },
          px: 1.75,
          py: 1.25,
          borderRadius: 2,
          border: 1,
          borderColor: "divider",
          bgcolor: isUser ? "background.paper" : "action.hover",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mb: 0.5 }}>
          <Typography variant="caption" sx={{ fontFamily: "var(--font-geist-mono), monospace", color: "text.secondary" }}>
            #{message.position}
          </Typography>
          <Typography variant="caption" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {message.role}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {formatDateTime(message.created_at)}
          </Typography>
          {message.is_expired ? <Chip label="expired" color="warning" variant="outlined" /> : null}
        </Box>
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {message.content}
        </Typography>
      </Box>
    </Box>
  );
}
