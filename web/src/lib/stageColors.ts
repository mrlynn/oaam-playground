import type { Stage } from "./runTypes";

// One hue per lifecycle stage, readable on light and dark backgrounds.
export const STAGE_ORDER: Stage[] = ["retrieval", "ingestion", "summarization", "extraction", "consolidation", "revision", "other"];

export const STAGE_COLOR: Record<Stage, string> = {
  retrieval: "#2563eb",
  ingestion: "#0d9488",
  summarization: "#db2777",
  extraction: "#7c3aed",
  consolidation: "#d97706",
  revision: "#dc2626",
  other: "#6b7280",
};
