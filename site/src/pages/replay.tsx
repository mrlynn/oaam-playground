import {CORRECTION, MIXED} from '@inspector/lib/demoExport';
import Heading from '@theme/Heading';
import Layout from '@theme/Layout';
import {useEffect, useRef, useState} from 'react';

import {conversation, conversations, DEFAULT_CONVERSATION, demo, keyOfRun, utc} from '@site/src/components/replay/data';
import Findings from '@site/src/components/replay/Findings';
import ReplayView, {type ReplayState, type View} from '@site/src/components/replay/ReplayView';
import s from './replay.module.css';

const VIEWS: View[] = ['memory', 'why', 'lifecycle'];
const s3 = conversation('support_03');
const s1 = conversation('support_01');
const mixed = s3.turns.find((t) => t.user_message?.includes(MIXED))?.turn ?? 1;
const correction = s1.turns.find((t) => t.user_message?.includes(CORRECTION))?.turn ?? s1.turns.length;

const INITIAL: ReplayState = {c: DEFAULT_CONVERSATION, turn: mixed, view: 'why'};

const MOMENTS: {title: string; body: string; state: ReplayState}[] = [
  {
    title: 'The miss',
    body: 'Alice asks two things at once. Open "why" and look at what reached the prompt: the badges are the health check calling out memories that shouldn\'t be there.',
    state: {c: 'support_03', turn: mixed, view: 'why'},
  },
  {
    title: 'Where the stale fact came from',
    body: `Turn ${correction - 1} of support_01 stores the bucket region. Step to turn ${correction}: she corrects it, and a new memory is added next to the old one instead of replacing it.`,
    state: {c: 'support_01', turn: correction - 1, view: 'memory'},
  },
  {
    title: 'What the package did',
    body: `The lifecycle of that correction turn: the searches, the context summary, the past-memory lookup, extraction and the store write, as a waterfall.`,
    state: {c: 'support_01', turn: correction, view: 'lifecycle'},
  },
];

function readUrl(): ReplayState | null {
  const q = new URLSearchParams(window.location.search);
  const key = q.get('c');
  if (!key || !conversations.some((c) => c.key === key)) return null;
  const count = conversation(key).turns.length;
  const turn = Number(q.get('turn'));
  const view = q.get('view') as View;
  return {c: key, turn: Number.isInteger(turn) && turn >= 1 ? Math.min(turn, count) : count, view: VIEWS.includes(view) ? view : 'memory'};
}

export default function Replay() {
  const [state, setState] = useState<ReplayState>(INITIAL);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fromUrl = readUrl();
    if (fromUrl) setState(fromUrl);
  }, []);
  useEffect(() => {
    const q = new URLSearchParams({c: state.c, turn: String(state.turn), view: state.view});
    window.history.replaceState(null, '', `${window.location.pathname}?${q}${window.location.hash}`);
  }, [state]);

  const show = (next: ReplayState) => {
    setState(next);
    top.current?.scrollIntoView({behavior: 'smooth', block: 'start'});
  };
  const goTurn = (runId: string, turn: number, why: boolean) => {
    const key = keyOfRun(runId);
    if (key) show({c: key, turn, view: why ? 'why' : 'memory'});
  };

  return (
    <Layout title="Replay" description="A recorded run of the memory inspector's seeded demo, stepped turn by turn in the browser.">
      <main className="container margin-vert--lg">
        <div className={s.intro}>
          <Heading as="h1">Replay</Heading>
          <p>
            Four scripted support conversations, replayed through a real agent with <code>oracleagentmemory</code> and recorded by the inspector. Step through any
            conversation, ask "why?" of any reply, and follow a badge to the health finding behind it. This is the dashboard's view, computed by the dashboard's own
            code, from an export taken {utc(demo.manifest.exported_at)}. Nothing on this page talks to a database.
          </p>
        </div>

        <div className={s.moments}>
          {MOMENTS.map((m) => (
            <button key={m.title} type="button" className={s.moment} onClick={() => show(m.state)}>
              <strong>{m.title}</strong>
              <span>{m.body}</span>
            </button>
          ))}
        </div>

        <div ref={top} className={s.anchor}>
          <ReplayView state={state} onChange={setState} picker findingHref={(id) => `#finding-${id}`} />
        </div>

        <section id="findings" className={s.findings}>
          <Heading as="h2">What the health check found</Heading>
          <p>
            The same store, checked as a whole: close pairs found with <code>VECTOR_DISTANCE</code> inside Oracle, then sorted by an LLM judge. Judgments are labelled as
            judgments. Every finding has its evidence and a fix you can run.
          </p>
          <Findings goTurn={goTurn} />
        </section>
      </main>
    </Layout>
  );
}
