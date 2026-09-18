"use client";

import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

/** Monospace short id with a copy-full-id button. */
export default function CopyId({ id, chars = 8 }: { id: string; chars?: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <Typography component="span" variant="body2" sx={{ fontFamily: "var(--font-geist-mono), monospace", whiteSpace: "nowrap" }}>
      {id.slice(0, chars)}
      <Tooltip title={copied ? "Copied" : `Copy ${id}`}>
        <IconButton
          size="small"
          aria-label={`Copy id ${id}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            navigator.clipboard?.writeText(id).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          sx={{ ml: 0.25, p: 0.5 }}
        >
          <ContentCopyIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
    </Typography>
  );
}
