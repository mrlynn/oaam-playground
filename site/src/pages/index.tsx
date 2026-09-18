import Link from '@docusaurus/Link';
import Heading from '@theme/Heading';
import Layout from '@theme/Layout';

import TurnReplay from '@site/src/components/replay/TurnReplay';
import s from './index.module.css';

const NEXT = [
  {to: '/docs/tutorial/first-run', title: 'See it work', body: 'From a clean machine to the dashboard, in about fifteen minutes.'},
  {to: '/docs/how-to/instrument-your-agent', title: 'Add it to your agent', body: 'One inspect() call around your memory client. Two lines if you also report the prompt.'},
  {to: '/docs/friction', title: 'What we learned', body: 'Five fixes the package could make, each with a script that reproduces the problem.'},
];

export default function Home() {
  return (
    <Layout description="A memory debugger for Oracle AI Agent Memory: see what an agent remembered, which memories reached the prompt, and what's wrong with the store.">
      <main className="container margin-vert--lg">
        <header className={s.hero}>
          <p className={s.eyebrow}>agent memory inspector · for oracleagentmemory</p>
          <Heading as="h1" className={s.title}>
            Why did the agent say that?
          </Heading>
          <p className={s.lede}>
            Agents with long-term memory fail quietly. A stale fact reaches the prompt, a real preference gets crowded out, and from the outside it all looks the
            same. The inspector records every turn and shows you what the model was actually given.
          </p>
          <p className={s.lede}>
            Below is a real recorded turn. Alice asks which region her export bucket is in and how to contact her. Look at what the search handed the model.
          </p>
        </header>

        <TurnReplay conversation="support_03" view="why" />

        <div className={s.next}>
          <Link to="/replay" className={s.primary}>
            Open the full replay, with all four conversations and the health check →
          </Link>
          <div className={s.cards}>
            {NEXT.map((n) => (
              <Link key={n.to} to={n.to} className={s.card}>
                <strong>{n.title}</strong>
                <span>{n.body}</span>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </Layout>
  );
}
