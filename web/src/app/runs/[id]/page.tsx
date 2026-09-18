import type { Metadata } from "next";
import { notFound } from "next/navigation";

import ThreadView from "@/components/ThreadView";
import RunView from "@/components/run/RunView";
import type { WhyRow } from "@/components/run/WhyPanel";
import { shortId } from "@/lib/format";
import { memoryStateAt, parseTurn, turnByMessage } from "@/lib/memoryState";
import {
  getMemoriesByIds,
  getMemoryOrigins,
  getMessages,
  getMessagesByIds,
  getRun,
  getThread,
  getThreadMemories,
  getTurnPrompt,
  getTurns,
} from "@/lib/queries";

export async function generateMetadata({ params }: PageProps<"/runs/[id]">): Promise<Metadata> {
  const { id } = await params;
  return { title: `Run ${shortId(id)} · Memory Inspector` };
}

export default async function RunPage({ params, searchParams }: PageProps<"/runs/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const includeExpired = sp.expired === "1";

  const [thread, run, turns] = await Promise.all([getThread(id), getRun(id), getTurns(id)]);
  if (!thread) notFound();

  const [messages, memories] = await Promise.all([
    getMessages(id, includeExpired),
    getThreadMemories(id, thread.user_id, includeExpired),
  ]);

  // No run log for this thread (created outside the inspector): the M2 view.
  if (!run || turns.length === 0) {
    return <ThreadView thread={thread} messages={messages} memories={memories} includeExpired={includeExpired} />;
  }

  const turn = parseTurn(sp.turn, turns.length);
  const view = sp.view === "why" ? "why" : "memory";
  const state = memoryStateAt(memories.filter((m) => m.thread_id === id), turns, turn);

  let whyRows: WhyRow[] = [];
  let prompt = null;
  if (view === "why") {
    const retrieved = [...(turns.find((t) => t.turn === turn)?.retrieved ?? [])].sort(
      (a, b) => a.search - b.search || a.rank - b.rank,
    );
    const ids = [...new Set(retrieved.map((r) => r.record_id))];
    const [rows, msgs, origins, p] = await Promise.all([
      getMemoriesByIds(ids),
      getMessagesByIds(retrieved.filter((r) => r.record_type === "message").map((r) => r.record_id)),
      getMemoryOrigins(ids),
      getTurnPrompt(id, turn),
    ]);
    prompt = p;
    const asOfTurn = new Map(state.map((m) => [m.id, m]));
    const current = new Map(rows.map((m) => [m.memory_id, m]));
    const messageById = new Map(msgs.map((m) => [m.message_id, m]));
    const originOf = new Map(origins.map((o) => [o.memory_id, { runId: o.run_id, turn: o.turn }]));
    whyRows = retrieved.map((r) => {
      const known = asOfTurn.get(r.record_id);
      const row = current.get(r.record_id);
      const msg = messageById.get(r.record_id);
      return {
        ...r,
        content: known?.content ?? row?.content ?? msg?.content ?? null,
        origin: originOf.get(r.record_id) ?? null,
        storedThread: row?.thread_id ?? msg?.thread_id ?? r.thread_id,
        gone: !row && !msg,
      };
    });
  }

  return (
    <RunView
      thread={thread}
      run={run}
      turns={turns}
      turn={turn}
      view={view}
      includeExpired={includeExpired}
      messages={messages}
      messageTurns={turnByMessage(turns)}
      state={state}
      whyRows={whyRows}
      prompt={prompt}
    />
  );
}
