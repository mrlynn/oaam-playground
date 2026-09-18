// Export the seeded demo from AIM_APP for the docs site's replay.
//
//   cd web && npm run export-demo
//
// Reads as aim_web through the AIM_V_* views, the same way the dashboard does,
// so the export can't hold anything the dashboard couldn't already show. Only
// AIM_APP (the scripted seeds) is ever exported: real conversations in AIM_LIVE
// never leave this machine. A seed that misses a demo moment isn't written.

import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import oracledb from "oracledb";

import { checkMoments, type DemoExport } from "../src/lib/demoExport.ts";

const SCHEMA = "AIM_APP";
const SEED_USERS = ["u_alice", "u_bob"];
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(REPO, "site/src/data/demo.json");

const args = process.argv.slice(2);
const asked = args.includes("--schema") ? args[args.indexOf("--schema") + 1] : SCHEMA;
if (asked?.toUpperCase() !== SCHEMA) {
  console.error(`refusing to export ${asked}: only ${SCHEMA} (the scripted seeds) is ever exported`);
  process.exit(1);
}
if (process.env.AIM_SCHEMA && process.env.AIM_SCHEMA.toUpperCase() !== SCHEMA) {
  console.log(`(AIM_SCHEMA=${process.env.AIM_SCHEMA} in .env.local is ignored: the export always reads ${SCHEMA})`);
}
const password = process.env.AIM_WEB_PASSWORD;
if (!password) {
  console.error("AIM_WEB_PASSWORD is not set. Run with --env-file=.env.local from web/.");
  process.exit(1);
}

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchTypeHandler = (meta) => (meta.dbType === oracledb.DB_TYPE_CLOB ? { type: oracledb.STRING } : undefined);

const conn = await oracledb.getConnection({
  user: process.env.AIM_WEB_USER ?? "aim_web",
  password,
  connectString: process.env.AIM_DB_DSN ?? "localhost:1521/FREEPDB1",
});

async function q<T>(sql: string, binds: Record<string, unknown> = {}): Promise<T[]> {
  const r = await conn.execute<Record<string, unknown>>(sql.replaceAll("aim_v_", `${SCHEMA}.AIM_V_`), binds as oracledb.BindParameters);
  return (r.rows ?? []).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v])) as T);
}

function inList(prefix: string, values: string[]) {
  const binds = Object.fromEntries(values.map((v, i) => [`${prefix}${i}`, v]));
  return { sql: Object.keys(binds).map((k) => `:${k}`).join(", ") || "null", binds };
}

/** "support_03" etc., by matching each run's first user message to companion/conversations/*.yaml. */
function conversationKeys(): { key: string; user: string; first: string }[] {
  const dir = join(REPO, "companion/conversations");
  return readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort().map((f) => {
    const text = readFileSync(join(dir, f), "utf8");
    const user = /^user_id:\s*(\S+)/m.exec(text)?.[1] ?? "";
    const first = /- role: user\s*\n\s*content:\s*"?([^"\n]+)/.exec(text)?.[1] ?? "";
    return { key: f.replace(/\.yaml$/, ""), user, first: first.trim() };
  });
}

type Row = Record<string, unknown>;
try {
  const users = inList("u", SEED_USERS);
  const runs = await q<Row>(`select * from aim_v_runs where source = 'replay' and user_id in (${users.sql}) order by first_turn_at`, users.binds);
  if (!runs.length) throw new Error(`no replayed seed runs in ${SCHEMA}: run agent/scripts/seed.py --reset`);
  const keys = conversationKeys();
  const runIds = runs.map((r) => String(r.run_id));
  const ids = inList("r", runIds);

  const [threads, turns, messages, events, memories, origins] = await Promise.all([
    q<Row>(`select * from aim_v_threads where thread_id in (${ids.sql})`, ids.binds),
    q<Row>(`select * from aim_v_turns where run_id in (${ids.sql}) order by run_id, turn`, ids.binds),
    q<Row>(`select * from aim_v_messages where thread_id in (${ids.sql}) order by thread_id, position`, ids.binds),
    q<Row>(`select * from aim_v_run_events where run_id in (${ids.sql}) order by run_id, turn, seq`, ids.binds),
    q<Row>(`select * from aim_v_memories where user_id in (${users.sql}) order by after_message_position, seq`, users.binds),
    q<Row>(
      `select jt.memory_id, t.run_id, min(t.turn) as turn
         from aim_v_turns t,
              json_table(t.memory_diff, '$.created[*]' columns (memory_id varchar2(128) path '$.id')) jt
        where t.run_id in (${ids.sql})
        group by jt.memory_id, t.run_id`,
      ids.binds,
    ),
  ]);

  const conversations = runs.map((run) => {
    const runTurns = turns.filter((t) => t.run_id === run.run_id);
    const first = String(runTurns[0]?.user_message ?? "");
    const match = keys.filter((k) => k.user === run.user_id && k.first && first.startsWith(k.first.slice(0, 40)));
    if (match.length !== 1) throw new Error(`run ${run.run_id}: matched ${match.length} conversation files by its first message`);
    const strip = (r: Row) => { const { run_id: _r, ...rest } = r; return rest; };
    return {
      key: match[0].key,
      thread: threads.find((t) => t.thread_id === run.run_id),
      run,
      turns: runTurns.map(strip),
      messages: messages.filter((m) => m.thread_id === run.run_id),
      events: events.filter((e) => e.run_id === run.run_id).map(strip),
    };
  }).sort((a, b) => a.key.localeCompare(b.key));

  // Raw message chunks a search returned from outside the exported threads.
  const have = new Set(messages.map((m) => String(m.message_id)));
  const wanted = [...new Set(turns.flatMap((t) => ((t.retrieved as Row[] | null) ?? [])
    .filter((r) => r.record_type === "message" && !have.has(String(r.record_id))).map((r) => String(r.record_id))))];
  const extra = inList("m", wanted);
  const extraMessages = wanted.length ? await q<Row>(`select * from aim_v_messages where message_id in (${extra.sql})`, extra.binds) : [];

  // The dashboard's rule: the latest finished check, compared with the previous one of the same scope and judge.
  const [checkRun] = await q<Row>(`select * from aim_v_check_runs where finished_at is not null order by check_run_id desc fetch first 1 row only`);
  let findings: Row[] = [];
  let previous: Row[] | null = null;
  if (checkRun) {
    findings = await q<Row>(
      `select * from aim_v_findings where check_run_id = :id and (user_id is null or user_id in (${users.sql}))
        order by case severity when 'high' then 0 when 'medium' then 1 else 2 end, kind, finding_id`,
      { id: checkRun.check_run_id, ...users.binds },
    );
    const [prev] = await q<Row>(
      `select check_run_id from aim_v_check_runs
        where finished_at is not null and check_run_id < :id
          and decode(scope_user_id, :scope, 1, 0) = 1 and decode(judge_model, :judge, 1, 0) = 1
        order by check_run_id desc fetch first 1 row only`,
      { id: checkRun.check_run_id, scope: checkRun.scope_user_id, judge: checkRun.judge_model },
    );
    if (prev) {
      previous = await q<Row>(
        `select fingerprint, kind, title from aim_v_findings where check_run_id = :id and (user_id is null or user_id in (${users.sql}))`,
        { id: prev.check_run_id, ...users.binds },
      );
    }
  }

  let gitSha: string | null = null;
  try { gitSha = execSync("git rev-parse --short HEAD", { cwd: REPO }).toString().trim(); } catch { /* not a checkout */ }
  const run0 = runs[0];
  const data = {
    manifest: {
      exported_at: new Date().toISOString(),
      schema: SCHEMA,
      git_sha: gitSha,
      package_version: (run0.package_version as string) ?? null,
      llm_model: (run0.llm_model as string) ?? null,
      embed_model: (run0.embed_model as string) ?? null,
      check_run_id: (checkRun?.check_run_id as number) ?? null,
      judge_model: (checkRun?.judge_model as string) ?? null,
    },
    conversations,
    memories,
    extraMessages,
    origins,
    checkRun: checkRun ?? null,
    findings,
    previous,
  } as unknown as DemoExport;

  // Round-trip through JSON so the checks see exactly what the site will load.
  const json = JSON.stringify(data, null, 1);
  const moments = checkMoments(JSON.parse(json));
  for (const m of moments) console.log(`${m.ok ? "ok  " : m.required ? "MISS" : "note"}  ${m.name}: ${m.detail}`);
  const missed = moments.filter((m) => m.required && !m.ok);
  if (missed.length) {
    console.error(`\nnot written: ${missed.length} demo moment${missed.length === 1 ? "" : "s"} didn't reproduce in this seed. Reseed, or run scripts/check.py.`);
    process.exitCode = 1;
  } else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, json + "\n");
    const kb = Math.round(statSync(OUT).size / 1024);
    console.log(`\nwrote ${OUT.replace(REPO + "/", "")} (${kb} KB): ${conversations.map((c) => `${c.key} ${c.turns.length} turns`).join(", ")}; check #${data.manifest.check_run_id}, ${findings.length} findings`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await conn.close();
}
