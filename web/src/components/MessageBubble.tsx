import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import Link from "next/link";

import { formatDateTime } from "@/lib/format";
import type { MessageRow } from "@/lib/queries";

type Props = {
  message: MessageRow;
  /** The run log turn that wrote this message, when there is one. */
  turn?: number;
  /** After the scrubbed turn: collapsed and faded. */
  later?: boolean;
  /** Written in the scrubbed turn. */
  current?: boolean;
  /** Link to this reply's "why" view. */
  whyHref?: string;
};

export default function MessageBubble({ message, turn, later, current, whyHref }: Props) {
  const isUser = message.role === "user";
  return (
    <Box
      id={`msg-${message.position}`}
      sx={{
        display: "flex",
        justifyContent: isUser ? "flex-start" : "flex-end",
        opacity: message.is_expired || later ? 0.4 : 1,
        transition: "opacity 150ms",
      }}
    >
      <Box
        sx={{
          maxWidth: { xs: "92%", sm: "80%" },
          px: 1.75,
          py: 1.25,
          borderRadius: 2,
          border: 1,
          borderColor: current ? "primary.main" : "divider",
          outline: current ? 1 : 0,
          outlineColor: "primary.main",
          bgcolor: isUser ? "background.paper" : "action.hover",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 1, mb: 0.5 }}>
          <Typography variant="caption" sx={{ fontFamily: "var(--font-geist-mono), monospace", color: "text.secondary" }}>
            #{message.position}
          </Typography>
          <Typography variant="caption" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {message.role}
          </Typography>
          {turn != null ? (
            <Typography variant="caption" color="text.secondary">
              turn {turn}
            </Typography>
          ) : null}
          <Typography variant="caption" color="text.secondary">
            {formatDateTime(message.created_at)}
          </Typography>
          {message.is_expired ? <Chip label="expired" color="warning" variant="outlined" /> : null}
          {whyHref && !later ? (
            <Link href={whyHref} scroll={false} aria-label={`Why did turn ${turn} reply this way?`}>
              <Chip label="why?" size="small" color="primary" variant="outlined" clickable />
            </Link>
          ) : null}
        </Box>
        <Typography
          variant="body2"
          sx={{
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            ...(later ? { display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" } : {}),
          }}
        >
          {message.content}
        </Typography>
      </Box>
    </Box>
  );
}
