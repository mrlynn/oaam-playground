"use client";

import Chip, { type ChipProps } from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";

/**
 * A Chip with a Tooltip, rendered entirely on the client. Passing a Chip from
 * a server component into Tooltip (which clones its child) caused a hydration
 * mismatch on /runs, so the pair lives together here.
 */
export default function HintChip({ hint, ...chip }: ChipProps & { hint: string }) {
  return (
    <Tooltip title={hint}>
      <Chip {...chip} />
    </Tooltip>
  );
}
