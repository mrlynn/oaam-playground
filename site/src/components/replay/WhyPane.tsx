import {fmtDistance} from '@inspector/lib/format';
import {promptLabel} from '@inspector/lib/memoryState';
import {memoryTypeColor} from '@inspector/lib/memoryTypes';
import {type WhyRow, whySummary} from '@inspector/lib/why';
import type {DemoTurn} from '@inspector/lib/demoExport';
import clsx from 'clsx';

import {Chip, ChipLink} from './Chip';
import {hasRun, runLabel} from './data';
import s from './styles.module.css';

type Props = {
  runId: string;
  turn: DemoTurn;
  rows: WhyRow[];
  goTurn: (n: number) => void;
  goRun: (runId: string, turn: number) => void;
  findingHref: (id: number) => string;
};

/** What turn n's reply was built from. Mirrors the dashboard's WhyPanel. */
export default function WhyPane({runId, turn, rows, goTurn, goRun, findingHref}: Props) {
  const queries = turn.attrs?.queries ?? [];
  const searches = [...new Set(rows.map((r) => r.search))].sort((a, b) => a - b);
  const max = Math.max(0.0001, ...rows.map((r) => r.distance ?? 0));
  return (
    <div className={s.stack}>
      <div className={s.card}>
        <div className={s.label}>Why turn {turn.turn} replied the way it did</div>
        {turn.user_message ? <div className={s.quote}>“{turn.user_message}”</div> : null}
        <div className={s.meta}>{whySummary(rows)}</div>
      </div>
      {searches.map((n) => (
        <div key={n} className={s.stack}>
          <div className={s.meta}>
            search {n}
            {queries[n - 1] ? <> · “{queries[n - 1]}”</> : null} · distance, lower is closer
          </div>
          {rows
            .filter((r) => r.search === n)
            .map((r) => (
              <Result key={`${n}-${r.rank}`} runId={runId} row={r} max={max} goTurn={goTurn} goRun={goRun} findingHref={findingHref} />
            ))}
        </div>
      ))}
      {turn.assembled_prompt ? (
        <details className={s.card}>
          <summary>
            Prompt the model saw
            {turn.prompt_tokens != null ? ` · ${turn.prompt_tokens} tokens` : ''}
            {turn.flat_history_tokens != null ? ` (flat history would be ${turn.flat_history_tokens})` : ''}
            {turn.reply_source === 'scripted' ? ' · reply was scripted' : ''}
          </summary>
          <pre className={s.prompt}>{turn.assembled_prompt}</pre>
        </details>
      ) : null}
    </div>
  );
}

function Result({runId, row: r, max, goTurn, goRun, findingHref}: {row: WhyRow; max: number} & Omit<Props, 'turn' | 'rows'>) {
  const label = promptLabel(r);
  const type = r.record_type ?? 'unknown';
  const isMessage = type === 'message';
  const pct = r.distance == null ? 0 : Math.max(4, Math.round((1 - r.distance / (max * 1.05)) * 100));
  return (
    <div
      className={clsx(s.card, label !== 'in prompt' && r.in_prompt !== null && s.dim)}
      style={{borderLeftColor: isMessage ? undefined : memoryTypeColor(type)}}>
      <div className={s.cardHead}>
        <span className={s.rank}>#{r.rank}</span>
        {isMessage ? <Chip>{type}</Chip> : <Chip color={memoryTypeColor(type)}>{type}</Chip>}
        <span className={s.bar} title={`distance ${fmtDistance(r.distance)}, as returned by search (lower is closer)`}>
          <span className={s.barTrack}>
            <span className={s.barFill} style={{width: `${pct}%`, display: 'block'}} />
          </span>
          {fmtDistance(r.distance)}
        </span>
        <Chip tone={label === 'in prompt' ? 'on' : undefined}>{label}</Chip>
        {isMessage ? (
          <Chip tone="warn" title="A raw message chunk, not a durable memory. Searches without record_types rank messages and memories together.">
            raw message
          </Chip>
        ) : null}
        {r.badges.map((b) => (
          <ChipLink
            key={`${b.findingId}-${b.label}`}
            href={findingHref(b.findingId)}
            tone={b.kind === 'superseded' || b.kind === 'contradiction' ? 'bad' : 'warn'}
            title={`Health check: ${b.hint}`}>
            {b.label}
          </ChipLink>
        ))}
      </div>
      <div className={clsx(s.content, r.gone && s.struck)}>{r.content ?? <em>(content not available)</em>}</div>
      <div className={s.foot}>
        <span>
          <Origin runId={runId} row={r} goTurn={goTurn} goRun={goRun} />
          {r.gone ? ' · since deleted' : ''}
        </span>
      </div>
    </div>
  );
}

function Origin({runId, row: r, goTurn, goRun}: {runId: string; row: WhyRow; goTurn: (n: number) => void; goRun: (runId: string, turn: number) => void}) {
  if (r.origin?.runId === runId) {
    const t = r.origin.turn;
    return (
      <>
        created at{' '}
        <button type="button" className={s.linkButton} onClick={() => goTurn(t)}>
          turn {t}
        </button>{' '}
        of this conversation
      </>
    );
  }
  if (r.origin) {
    const o = r.origin;
    return (
      <>
        created in an earlier conversation:{' '}
        {hasRun(o.runId) ? (
          <button type="button" className={s.linkButton} onClick={() => goRun(o.runId, o.turn)}>
            {runLabel(o.runId)}, turn {o.turn}
          </button>
        ) : (
          `${runLabel(o.runId)}, turn ${o.turn}`
        )}
      </>
    );
  }
  if (r.storedThread && r.storedThread !== runId) return <>stored on thread {runLabel(r.storedThread)}, before the run log</>;
  return <>created before the run log</>;
}
