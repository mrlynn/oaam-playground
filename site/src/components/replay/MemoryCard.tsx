import type {MemoryAt} from '@inspector/lib/memoryState';
import {promptLabel} from '@inspector/lib/memoryState';
import {fmtDistance} from '@inspector/lib/format';
import {memoryTypeColor} from '@inspector/lib/memoryTypes';
import clsx from 'clsx';

import {Chip} from './Chip';
import s from './styles.module.css';

/** One durable memory as it was at the scrubbed turn. Mirrors the dashboard's MemoryStateCard. */
export default function MemoryCard({memory: m, turn, goTurn}: {memory: MemoryAt; turn: number; goTurn: (n: number) => void}) {
  const removed = m.removedTurn !== null;
  const last = m.revisions.at(-1);
  const row = m.row;
  const labelMismatch = row?.extractor_scope != null && row.thread_id != null && row.extractor_scope !== 'thread';
  return (
    <div
      className={clsx(s.card, m.retrieval && s.cardRetrieved, m.newNow && s.cardNew, removed && !m.removedNow && s.cardFaded)}
      style={{borderLeftColor: memoryTypeColor(m.type)}}>
      <div className={s.cardHead}>
        <Chip color={memoryTypeColor(m.type)}>{m.type}</Chip>
        {m.newNow ? <Chip tone="good">created turn {turn}</Chip> : null}
        {m.retrieval ? (
          <Chip tone="on" title={`Search ${m.retrieval.search} this turn ranked it #${m.retrieval.rank} at distance ${fmtDistance(m.retrieval.distance)} (lower is closer).`}>
            retrieved #{m.retrieval.rank} · {fmtDistance(m.retrieval.distance)}
          </Chip>
        ) : null}
        {m.retrieval ? <Chip>{promptLabel(m.retrieval)}</Chip> : null}
        {m.revisedNow ? <Chip tone="warn">revised turn {turn}</Chip> : null}
        {removed ? <Chip tone={m.removedNow ? 'badFilled' : 'bad'}>removed turn {m.removedTurn}</Chip> : null}
      </div>
      {m.revisedNow && last ? <div className={clsx(s.content, s.struck)}>{last.before}</div> : null}
      <div className={clsx(s.content, removed && s.struck)}>{m.content}</div>
      <div className={s.foot}>
        <span>
          {m.createdTurn === null ? (
            'existed before the run log'
          ) : m.createdTurn === turn ? (
            'created this turn'
          ) : (
            <>
              created{' '}
              <button type="button" className={s.linkButton} onClick={() => goTurn(m.createdTurn!)}>
                turn {m.createdTurn}
              </button>
            </>
          )}
          {m.revisions.length && !m.revisedNow ? (
            <>
              {' · revised '}
              {m.revisions.map((r, i) => (
                <span key={r.turn}>
                  {i ? ', ' : ''}
                  <button type="button" className={s.linkButton} onClick={() => goTurn(r.turn)}>
                    turn {r.turn}
                  </button>
                </span>
              ))}
            </>
          ) : null}
        </span>
        {labelMismatch ? (
          <Chip tone="warn" title={`The extractor labelled this "${row!.extractor_scope}"-scoped, but it is stored on the thread: deleting the thread deletes it.`}>
            labelled {row!.extractor_scope}
          </Chip>
        ) : null}
        {!removed && !row ? <span>(no longer in the table)</span> : null}
      </div>
    </div>
  );
}
