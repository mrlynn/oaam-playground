import type { MemoryType } from "./queries";

// One hue per memory type. Mid-tones so they read on light and dark backgrounds.
export const MEMORY_TYPE_COLOR: Record<MemoryType, string> = {
  preference: "#8b5cf6",
  fact: "#3b82f6",
  guideline: "#d97706",
  memory: "#0d9488",
};

export function memoryTypeColor(type: string): string {
  return MEMORY_TYPE_COLOR[type as MemoryType] ?? "#6b7280";
}
