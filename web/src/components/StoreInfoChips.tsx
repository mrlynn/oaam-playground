import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";

import HintChip from "@/components/HintChip";
import { getStoreInfo } from "@/lib/queries";

/** Header chips describing the managed store. Renders nothing if the DB is unreachable. */
export default async function StoreInfoChips() {
  let info;
  try {
    info = await getStoreInfo();
  } catch {
    return <Chip label="database unreachable" color="error" variant="outlined" />;
  }
  if (!info) return null;

  const retention = parseRetention(info.retention_config);
  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
      <HintChip hint="ORACLEAGENTMEMORY_SCHEMA_META.schema_version" variant="outlined" label={`schema v${info.schema_version}`} />
      <HintChip hint="Embedding dimension fixed at schema creation" variant="outlined" label={`${info.vector_dim}-dim ${info.indexing_mode ?? ""}`.trim()} />
      <HintChip hint="Store-wide default time to live. Managed schemas have none unless configured." variant="outlined" label={retention} />
    </Stack>
  );
}

function parseRetention(raw: string | null): string {
  try {
    const cfg = JSON.parse(raw ?? "{}") as { default_ttl_days?: number | null };
    return cfg.default_ttl_days ? `TTL ${cfg.default_ttl_days}d` : "no default TTL";
  } catch {
    return "retention unknown";
  }
}
