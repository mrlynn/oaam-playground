import type { Metadata } from "next";
import { notFound } from "next/navigation";

import ThreadView from "@/components/ThreadView";
import RunView from "@/components/run/RunView";
import { shortId } from "@/lib/format";
import { memoryStateAt, parseTurn, turnByMessage } from "@/lib/memoryState";
import { type WhyRow, sortedRetrievals, whyRows as buildWhyRows } from "@/lib/why";
import {
  getLatestFindings,
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
    const current = turns.find((t) => t.turn === turn);
    const retrieved = sortedRetrievals(current);
    const ids = [...new Set(retrieved.map((r) => r.record_id))];
    const [rows, msgs, origins, p, findings] = await Promise.all([
      getMemoriesByIds(ids),
      getMessagesByIds(retrieved.filter((r) => r.record_type === "message").map((r) => r.record_id)),
      getMemoryOrigins(ids),
      getTurnPrompt(id, turn),
      getLatestFindings(),
    ]);
    prompt = p;
    whyRows = buildWhyRows({ turn: current, state, memories: rows, messages: msgs, origins, findings });
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
