import {memoryStateAt, turnByMessage} from '@inspector/lib/memoryState';
import {whyRows} from '@inspector/lib/why';
import clsx from 'clsx';
import {useEffect} from 'react';

import {ChipButton, Chip} from './Chip';
import {allMessages, conversation, conversations, demo, keyOfRun, threadMemories, utc} from './data';
import Lifecycle from './Lifecycle';
import MemoryCard from './MemoryCard';
import s from './styles.module.css';
import WhyPane from './WhyPane';

export type View = 'memory' | 'why' | 'lifecycle';
export type ReplayState = {c: string; turn: number; view: View};

type Props = {
  state: ReplayState;
  onChange: (next: ReplayState) => void;
  /** Show the conversation picker (the replay page); off on the landing page. */
  picker?: boolean;
  /** Where a health badge links: the finding on this page, or on the replay page. */
  findingHref: (id: number) => string;
  /** Where a link to another conversation goes when there's no picker. */
  otherRunHref?: (key: string, turn: number) => string;
};

/** One recorded conversation, stepped turn by turn. Mirrors the dashboard's /runs/[id]. */
export default function ReplayView({state, onChange, picker, findingHref, otherRunHref}: Props) {
  const c = conversation(state.c);
  const count = c.turns.length;
  const n = Math.min(Math.max(state.turn, 1), count);
  const current = c.turns.find((t) => t.turn === n)!;
  const go = (turn: number, view: View = state.view) => onChange({c: c.key, turn: Math.min(Math.max(turn, 1), count), view});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable=true]')) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft' && n > 1) go(n - 1);
      if (e.key === 'ArrowRight' && n < count) go(n + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const memories = threadMemories(c);
  const state_ = memoryStateAt(memories.filter((m) => m.thread_id === c.thread.thread_id), c.turns, n);
  const live = state_.filter((m) => m.removedTurn === null);
  const removed = state_.filter((m) => m.removedTurn !== null);
  const rows =
    state.view === 'why'
      ? whyRows({turn: current, state: state_, memories: demo.memories, messages: allMessages, origins: demo.origins, findings: demo.findings})
      : [];
  const messageTurns = turnByMessage(c.turns);
  const messages = c.messages.filter((m) => !m.is_expired);
  const diff = current.memory_diff;
  const count_ = (k: 'created' | 'updated' | 'deleted') => diff?.[k]?.length ?? 0;

  const goRun = (runId: string, turn: number) => {
    const key = keyOfRun(runId);
    if (!key) return;
    if (picker) onChange({c: key, turn, view: 'memory'});
    else if (otherRunHref) window.location.assign(otherRunHref(key, turn));
  };

  return (
    <div className={s.replay}>
      <div className={s.recorded}>
        recorded replay · exported {utc(demo.manifest.exported_at)} from the seeded demo · {demo.manifest.llm_model} · oracleagentmemory{' '}
        {demo.manifest.package_version} · no live database
      </div>

      {picker ? (
        <div className={s.picker} role="group" aria-label="Conversation">
          {conversations.map((x) => (
            <ChipButton key={x.key} tone={x.key === c.key ? 'on' : undefined} pressed={x.key === c.key} onClick={() => onChange({c: x.key, turn: x.turns.length, view: state.view})}>
              {x.key} · {x.run.user_id} · {x.turns.length} turn{x.turns.length === 1 ? '' : 's'}
            </ChipButton>
          ))}
        </div>
      ) : null}

      <div className={s.strip}>
        <div className={s.scrubber}>
          <button type="button" className={s.iconButton} aria-label="Previous turn" disabled={n <= 1} onClick={() => go(n - 1)}>
            ‹
          </button>
          <input
            type="range"
            aria-label="Turn"
            min={1}
            max={Math.max(count, 1)}
            step={1}
            value={n}
            disabled={count < 2}
            onChange={(e) => go(Number(e.target.value))}
          />
          <button type="button" className={s.iconButton} aria-label="Next turn" disabled={n >= count} onClick={() => go(n + 1)}>
            ›
          </button>
          <span className={s.turnOf}>
            turn {n} / {count}
          </span>
        </div>
        <div className={s.stats}>
          <Chip tone={count_('created') ? 'good' : undefined}>{count_('created')} created</Chip>
          <Chip tone={count_('updated') ? 'warn' : undefined}>{count_('updated')} updated</Chip>
          <Chip tone={count_('deleted') ? 'bad' : undefined}>{count_('deleted')} deleted</Chip>
          <Chip>{(current.retrieved ?? []).length} retrieved</Chip>
          {current.prompt_tokens != null ? (
            <Chip title="Tokens sent with memory (scoped) vs what the whole thread's history would cost (flat).">
              prompt {current.prompt_tokens} tok{current.flat_history_tokens != null ? ` · flat ${current.flat_history_tokens}` : ''}
            </Chip>
          ) : null}
          <span className={s.meta}>
            {current.duration_ms != null ? `${(current.duration_ms / 1000).toFixed(1)}s` : ''}
            {current.attrs?.closed_by ? ` · closed by ${current.attrs.closed_by}` : ''}
            {current.reply_source === 'scripted' ? ' · scripted reply' : ''}
          </span>
        </div>
      </div>

      <div className={s.tabs} role="tablist" aria-label="View">
        <ViewTab view="memory" state={state} go={go} label={`Memory at turn ${n}`} />
        <ViewTab view="why" state={state} go={go} label={`Why (turn ${n})`} />
        <ViewTab view="lifecycle" state={state} go={go} label={`Lifecycle of turn ${n}`} />
      </div>

      {state.view === 'lifecycle' ? (
        <Lifecycle conversation={c} turn={n} />
      ) : (
        <div className={s.grid}>
          <div>
            <div className={s.label}>Conversation · {c.key}</div>
            <div className={s.stack}>
              {messages.map((m) => {
                const t = messageTurns.get(m.message_id);
                const later = t != null && t > n;
                return (
                  <div key={m.message_id} className={clsx(s.msg, m.role === 'user' && s.msgUser, t === n && s.msgCurrent, later && s.msgLater)}>
                    <div className={s.msgHead}>
                      <span>{m.role}</span>
                      {t != null ? <span>turn {t}</span> : null}
                      <span className={s.grow} />
                      {t != null && m.role === 'assistant' ? (
                        <ChipButton tone={state.view === 'why' && t === n ? 'on' : undefined} onClick={() => go(t, 'why')}>
                          why?
                        </ChipButton>
                      ) : null}
                    </div>
                    <div className={s.msgText}>{m.content}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className={clsx(state.view === 'why' && s.whyFirst)}>
            <div className={s.pane}>
              {state.view === 'why' ? (
                <WhyPane runId={c.run.run_id} turn={current} rows={rows} goTurn={(t) => go(t, 'why')} goRun={goRun} findingHref={findingHref} />
              ) : (
                <div className={s.stack}>
                  {live.map((m) => (
                    <MemoryCard key={m.id} memory={m} turn={n} goTurn={(t) => go(t)} />
                  ))}
                  {live.length === 0 ? <div className={s.card}>No durable memories yet at turn {n}.</div> : null}
                  {removed.length ? (
                    <>
                      <div className={s.label}>Removed · {removed.length}</div>
                      {removed.map((m) => (
                        <MemoryCard key={m.id} memory={m} turn={n} goTurn={(t) => go(t)} />
                      ))}
                    </>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ViewTab({view, state, go, label}: {view: View; state: ReplayState; go: (turn: number, view: View) => void; label: string}) {
  const on = state.view === view;
  return (
    <button type="button" role="tab" aria-selected={on} className={clsx(s.chip, on && s.chipOn)} onClick={() => go(state.turn, view)}>
      {label}
    </button>
  );
}

