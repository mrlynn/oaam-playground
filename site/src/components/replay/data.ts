// The recorded demo, loaded once. Everything the replay shows comes from here
// and is computed by the dashboard's own functions in web/src/lib.

import {type DemoConversation, type DemoExport, reviveDates} from '@inspector/lib/demoExport';
import {compareRuns} from '@inspector/lib/findings';
import type {MemoryRow, MessageRow} from '@inspector/lib/runTypes';

import raw from '@site/src/data/demo.json';

export const demo: DemoExport = JSON.parse(JSON.stringify(raw), reviveDates) as DemoExport;

export const conversations: DemoConversation[] = demo.conversations;

const byKey = new Map(conversations.map((c) => [c.key, c]));
const keyByRun = new Map(conversations.map((c) => [c.run.run_id, c.key]));

export function conversation(key: string): DemoConversation {
  return byKey.get(key) ?? conversations[0];
}

/** "support_01" for a run id, or a short id for a run that isn't in the export. */
export function runLabel(runId: string): string {
  return keyByRun.get(runId) ?? runId.slice(0, 8);
}

export function hasRun(runId: string): boolean {
  return keyByRun.has(runId);
}

export function keyOfRun(runId: string): string | undefined {
  return keyByRun.get(runId);
}

/** What the dashboard's getThreadMemories returns, expired rows hidden. */
export function threadMemories(c: DemoConversation): MemoryRow[] {
  return demo.memories.filter(
    (m) => !m.is_expired && (m.thread_id === c.thread.thread_id || (m.thread_id == null && m.user_id === c.thread.user_id)),
  );
}

export const allMessages: MessageRow[] = [...conversations.flatMap((c) => c.messages), ...demo.extraMessages];

export const memoryById = new Map(demo.memories.map((m) => [m.memory_id, m]));

export const comparison = compareRuns(demo.findings, demo.previous);

/** Dates are shown in UTC so the built page and the browser agree. */
export function utc(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export const DEFAULT_CONVERSATION = 'support_03';
