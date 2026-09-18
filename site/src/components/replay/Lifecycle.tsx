import {
  COLLAPSED_DEPTH,
  endInferred,
  fmtSpanMs,
  producedBy,
  SHOW_ALL_UP_TO,
  stageTotals,
  waterfall,
} from '@inspector/lib/lifecycle';
import {STAGE_COLOR, STAGE_ORDER} from '@inspector/lib/stageColors';
import type {DemoConversation} from '@inspector/lib/demoExport';
import {useState} from 'react';

import {Chip} from './Chip';
import s from './styles.module.css';

/** What the memory package did during one turn, as a waterfall. Mirrors /runs/[id]/turn/[n]. */
export default function Lifecycle({conversation: c, turn: n}: {conversation: DemoConversation; turn: number}) {
  const [all, setAll] = useState(false);
  const turn = c.turns.find((t) => t.turn === n);
  const events = c.events.filter((e) => e.turn === n);
  if (!turn) return null;
  const showAll = all || events.length <= SHOW_ALL_UP_TO;
  const wf = waterfall(events, showAll ? Infinity : COLLAPSED_DEPTH);
  const totals = stageTotals(events, wf.totalMs);
  return (
    <div className={s.stack}>
      <div className={s.stats}>
        <Chip tone="on">{(wf.totalMs / 1000).toFixed(2)} s of package work</Chip>
        <Chip>{events.length} spans</Chip>
        {turn.attrs?.closed_by ? <Chip>closed by {turn.attrs.closed_by}</Chip> : null}
      </div>
      <div className={s.card}>
        <div className={s.legend}>
          {STAGE_ORDER.filter((st) => totals.some((t) => t.stage === st)).map((st) => (
            <span key={st}>
              <span className={s.swatch} style={{background: STAGE_COLOR[st]}} />
              {st}
            </span>
          ))}
          <span className={s.grow} />
          {wf.hidden ? (
            <button type="button" className={s.linkButton} onClick={() => setAll(true)}>
              show {wf.hidden} deeper spans
            </button>
          ) : null}
        </div>
        {events.length === 0 ? (
          <div className={s.meta}>No events were recorded for this turn.</div>
        ) : (
          <div className={s.spans} role="list" aria-label="Spans in start order">
            {wf.bars.map((b) => {
              const inferred = endInferred(b);
              const dur = fmtSpanMs(b.duration_ms);
              const color = STAGE_COLOR[b.stage];
              return (
                <div
                  key={b.event_id}
                  role="listitem"
                  className={s.span}
                  title={`${b.name} · ${b.stage} · ${dur} · ${b.source === 'wrapper' ? 'agent call' : 'package log'}${inferred ? ' · end inferred' : ''}${b.error ? ` · error: ${b.error}` : ''}`}>
                  <span className={s.spanName} style={{paddingLeft: `${Math.min(b.depth, 6) * 0.7}rem`, fontWeight: b.source === 'wrapper' ? 700 : 400}}>
                    {b.name} <span className={s.meta}>{dur}</span>
                  </span>
                  <span className={s.spanTrack}>
                    <span
                      className={s.spanBar}
                      style={{
                        left: `${b.leftPct}%`,
                        width: `${b.widthPct}%`,
                        background: inferred ? 'transparent' : color,
                        border: inferred ? `2px dashed ${color}` : 0,
                        opacity: b.depth >= 3 ? 0.6 : 1,
                      }}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <div className={s.meta}>
          Bars sit at their start offset and are as long as they took ({Math.round(wf.totalMs)} ms end to end). Dashed bars closed by
          inference: the package logged no end for them. The package's own LLM token spend isn't reported by the package, so it isn't shown.
        </div>
      </div>
      <div className={s.stageCards}>
        {totals.map((t) => (
          <div key={t.stage} className={s.stageCard} style={{borderTopColor: STAGE_COLOR[t.stage]}}>
            <div className={s.stageHead}>
              <strong>{t.stage}</strong>
              <span>
                {t.ms} ms · {Math.round(t.share * 100)}%
              </span>
            </div>
            <div className={s.meta}>
              {t.spans} span{t.spans === 1 ? '' : 's'}, time counted once per outermost {t.stage} span
            </div>
            {producedBy(t.stage, turn, events).map((line, i) => (
              <div key={i} className={s.content}>
                {line}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
