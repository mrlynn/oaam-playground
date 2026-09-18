import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Agent Memory Playground" };

// The front door of ./demo.sh: what the three parts are and one loop through them.
// Chat and Docs are proxied apps (next.config.ts), so they get plain links.
const PARTS: { href: string; next?: boolean; title: string; body: string; cta: string }[] = [
  {
    href: "/chat",
    title: "Chat",
    body: "Talk to the companion, an agent with long-term memory. After each reply it says what it remembered; “why?” shows which memories it was given.",
    cta: "Start a conversation",
  },
  {
    href: "/runs",
    next: true,
    title: "Inspector",
    body: "Step through any conversation turn by turn: what search returned, what reached the prompt, what extraction created. Memory shows the health check’s findings.",
    cta: "Open the runs",
  },
  {
    href: "/docs",
    title: "Docs",
    body: "How it works, how to add it to your own agent, and a replay of the seeded demo. What we learned lists five fixes the package could make.",
    cta: "Read the docs",
  },
];

const loop = (schema: string): ReactNode[] => [
  <>In <a href="/chat">Chat</a>, tell the companion something about your work, then ask about it in a new thread.</>,
  <>Click <b>why?</b> under the reply, then <b>turn 1 in inspector</b> to see the same turn in the inspector.</>,
  <>Run the health check (<code>cd agent &amp;&amp; uv run python scripts/check.py --user {schema}</code>) and read the findings under <Link href="/memories">Memory</Link>.</>,
  <><a href="/docs">Docs</a> explains what each finding means and how to stop it.</>,
];

export default function Home() {
  const schema = (process.env.AIM_SCHEMA ?? "AIM_APP").toLowerCase(); // what this inspector reads (lib/db.ts)
  return (
    <>
      <Box sx={{ mb: 3, maxWidth: 820 }}>
        <Typography variant="h1" gutterBottom>
          Agent Memory Playground
        </Typography>
        <Typography variant="body1" color="text.secondary">
          An agent with memory, the inspector that shows what it remembered and why it said what it said, and the docs that explain both. Built on
          Oracle AI Agent Memory (<code>oracleagentmemory</code>). A personal work sample, not an Oracle product.
        </Typography>
      </Box>

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, mb: 4 }}>
        {PARTS.map((p) => {
          const card = (
            <Paper variant="outlined" sx={{ p: 2.5, height: "100%", display: "flex", flexDirection: "column", gap: 1, "&:hover": { borderColor: "primary.main" } }}>
              <Typography variant="h2">{p.title}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
                {p.body}
              </Typography>
              <Typography variant="body2" color="primary" sx={{ fontWeight: 600 }}>
                {p.cta} →
              </Typography>
            </Paper>
          );
          return p.next ? (
            <Link key={p.href} href={p.href} style={{ textDecoration: "none" }}>
              {card}
            </Link>
          ) : (
            <a key={p.href} href={p.href} style={{ textDecoration: "none" }}>
              {card}
            </a>
          );
        })}
      </Box>

      <Box sx={{ maxWidth: 820 }}>
        <Typography variant="h2" gutterBottom>
          One loop through it
        </Typography>
        <Box component="ol" sx={{ pl: 3, m: 0, "& li": { mb: 1 } }}>
          {loop(schema).map((step, i) => (
            <Typography key={i} component="li" variant="body2">
              {step}
            </Typography>
          ))}
        </Box>
      </Box>
    </>
  );
}
