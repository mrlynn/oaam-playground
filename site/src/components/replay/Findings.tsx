import {Chip} from './Chip';
import {comparison, demo, utc} from './data';
import FindingCard from './FindingCard';
import s from './styles.module.css';

const SEVERITIES = ['high', 'medium', 'low'] as const;

/** The latest health check, as /memories shows it. */
export default function Findings({goTurn}: {goTurn: (runId: string, turn: number, why: boolean) => void}) {
  const run = demo.checkRun;
  if (!run) return <p>This export has no health check.</p>;
  const counts = run.counts ?? {};
  const isNew = [...comparison.status.values()].filter((v) => v === 'new').length;
  return (
    <div className={s.replay}>
      <div className={s.stats}>
        <Chip tone="on">check #{run.check_run_id}</Chip>
        <Chip>{counts.memories ?? '?'} memories</Chip>
        <Chip>{counts.candidate_pairs ?? '?'} close pairs</Chip>
        <Chip title={`${counts.judge_calls ?? 0} judge calls, ${counts.judge_cache_hits ?? 0} cached`}>judge {run.judge_model ?? 'none'}</Chip>
        <span className={s.meta}>
          {utc(run.finished_at)}
          {comparison.compared ? ` · ${isNew} new, ${demo.findings.length - isNew} still open, ${comparison.resolved.length} resolved since the previous check` : ''}
        </span>
      </div>
      {SEVERITIES.map((sev) => {
        const list = demo.findings.filter((f) => f.severity === sev);
        if (!list.length) return null;
        return (
          <section key={sev} className={s.stack}>
            <div className={s.label}>
              {sev} · {list.length}
            </div>
            {list.map((f) => (
              <FindingCard key={f.finding_id} finding={f} status={comparison.status.get(f.finding_id) ?? 'open'} goTurn={goTurn} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
