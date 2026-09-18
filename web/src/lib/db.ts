import "server-only";

import { connection } from "next/server";
import oracledb from "oracledb";

// The one connection pool for the whole app. Logged in as AIM_WEB, which can
// only SELECT from the AIM_V_* views, so the dashboard cannot write even by
// mistake.

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchTypeHandler = (meta) =>
  meta.dbType === oracledb.DB_TYPE_CLOB ? { type: oracledb.STRING } : undefined;

const SCHEMA = (process.env.AIM_SCHEMA ?? "AIM_APP").toUpperCase();
if (!/^[A-Z][A-Z0-9_$#]*$/.test(SCHEMA)) {
  throw new Error(`AIM_SCHEMA is not a valid Oracle identifier: ${SCHEMA}`);
}

/** Qualify a view name with the owning schema, e.g. v("aim_v_threads"). */
export function v(view: `aim_v_${string}`): string {
  return `${SCHEMA}.${view.toUpperCase()}`;
}

const globalForPool = globalThis as unknown as { aimPool?: Promise<oracledb.Pool> };

function getPool(): Promise<oracledb.Pool> {
  // Cached on globalThis so dev hot reloads reuse the pool instead of leaking one.
  globalForPool.aimPool ??= oracledb
    .createPool({
      user: process.env.AIM_WEB_USER ?? "aim_web",
      password: required("AIM_WEB_PASSWORD"),
      connectString: process.env.AIM_DB_DSN ?? "localhost:1521/FREEPDB1",
      poolMin: 0,
      poolMax: 4,
      poolIncrement: 1,
    })
    .catch((err) => {
      globalForPool.aimPool = undefined;
      throw err;
    });
  return globalForPool.aimPool;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy web/.env.example to web/.env.local.`);
  return value;
}

/** Run a read query. Column names come back lowercased. */
export async function query<T>(sql: string, binds: oracledb.BindParameters = {}): Promise<T[]> {
  await connection(); // request-time only: never query during prerender or build
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    const result = await conn.execute<Record<string, unknown>>(sql, binds);
    return (result.rows ?? []).map(
      (row) => Object.fromEntries(Object.entries(row).map(([k, val]) => [k.toLowerCase(), val])) as T,
    );
  } finally {
    await conn.close();
  }
}
