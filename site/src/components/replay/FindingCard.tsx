import {crowdedLabel, evidenceLines, type FindingStatus, KIND_LABEL, memoryRole, methodLabel} from '@inspector/lib/findings';
import {memoryTypeColor} from '@inspector/lib/memoryTypes';
import type {FindingRow} from '@inspector/lib/runTypes';
import clsx from 'clsx';

import {Chip, ChipButton} from './Chip';
import {demo, hasRun, memoryById, runLabel} from './data';
import s from './styles.module.css';

const SEVERITY_TONE = {high: 'badFilled', medium: 'warn', low: undefined} as const;
const MAX_MEMORIES = 6;

type Props = {finding: FindingRow; status: FindingStatus; goTurn: (runId: string, turn: number, why: boolean) => void};

/** One health finding: what is wrong, the evidence, and the fix. Mirrors the dashboard's FindingCard. */
export default function FindingCard({finding: f, status, goTurn}: Props) {
  const ids = f.kind === 'orphan_chunks' ? [] : (f.memory_ids ?? []);
  const origin = (id: string) => demo.origins.find((o) => o.memory_id === id);
  const lines = evidenceLines(f);
  return (
    <article id={`finding-${f.finding_id}`} className={s.finding}>
      <div className={s.cardHead}>
        <Chip tone={SEVERITY_TONE[f.severity]}>{f.severity}</Chip>
        <Chip>{KIND_LABEL[f.kind]}</Chip>
        {status === 'new' ? <Chip tone="on">new</Chip> : null}
        {f.user_id ? <Chip>user {f.user_id}</Chip> : null}
        <span className={s.meta}>decided by {methodLabel(f.method)}</span>
      </div>
      <h3>{f.title}</h3>
      {f.detail ? <div className={s.meta}>{f.detail}</div> : null}
      {ids.length ? (
        <div className={s.stack}>
          {ids.slice(0, MAX_MEMORIES).map((id) => {
            const m = memoryById.get(id);
            const o = origin(id);
            const role = memoryRole(f, id);
            const wasted = crowdedLabel(f, id);
            return (
              <div key={id} className={s.involved} style={{borderLeftColor: m ? memoryTypeColor(m.memory_type) : undefined}}>
                <div className={s.cardHead}>
                  {m ? <Chip color={memoryTypeColor(m.memory_type)}>{m.memory_type}</Chip> : null}
                  {role ? <Chip tone={role === 'stale' ? 'bad' : 'good'}>{role}</Chip> : null}
                  {wasted ? <Chip tone="warn">{wasted}</Chip> : null}
                  <span className={s.meta}>
                    {o && hasRun(o.run_id) ? (
                      <button type="button" className={s.linkButton} onClick={() => goTurn(o.run_id, o.turn, false)}>
                        created turn {o.turn} of {runLabel(o.run_id)}
                      </button>
                    ) : m ? (
                      'created before the run log'
                    ) : (
                      'deleted since this check'
                    )}
                  </span>
                </div>
                <div className={clsx(s.content, !m && s.struck)}>{m?.content ?? id}</div>
              </div>
            );
          })}
          {ids.length > MAX_MEMORIES ? <div className={s.meta}>and {ids.length - MAX_MEMORIES} more</div> : null}
        </div>
      ) : null}
      {f.turns?.length ? (
        <div className={s.stats}>
          <span className={s.meta}>see why:</span>
          {f.turns.map((t) =>
            hasRun(t.run_id) ? (
              <ChipButton key={`${t.run_id}-${t.turn}`} onClick={() => goTurn(t.run_id, t.turn, true)}>
                turn {t.turn} of {runLabel(t.run_id)}
              </ChipButton>
            ) : null,
          )}
        </div>
      ) : null}
      {lines.length ? (
        <dl className={s.evidence}>
          {lines.map((l, i) => (
            <div key={i} style={{display: 'contents'}}>
              <dt>{l.label}</dt>
              <dd>{l.text}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {f.suggestion ? (
        <div>
          <div className={s.meta}>suggested fix</div>
          <pre className={s.fix}>{f.suggestion}</pre>
        </div>
      ) : null}
    </article>
  );
}
