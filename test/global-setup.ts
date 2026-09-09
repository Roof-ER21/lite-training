/**
 * test/global-setup.ts — vitest globalSetup for the integration suite.
 *
 *   1. Points at a LOCAL throwaway Postgres database (default
 *      postgresql://<you>@127.0.0.1:5432/litetraining_test_mcp21; create it
 *      once with `createdb litetraining_test_mcp21`). The public schema is
 *      dropped on each run, so runs never bleed into each other.
 *   2. Spawns the server from the working tree (tsx server/index.ts) on a
 *      free port and waits for /api/health to report the database connected.
 *      The app creates and migrates its own schema at boot
 *      (server/db/connection.ts initDatabase) — that is how schema changes
 *      reach prod on this app, so the MCP tables must appear the same way.
 *   3. Seeds one manager and one trainee, each with a login session row, and
 *      publishes ids, tokens and the base URL to the workers via process.env.
 *
 * Overrides:
 *   TEST_DATABASE_URL — use this (local) Postgres URL instead of the default.
 *
 * The spawned server's combined stdout/stderr is written to
 * $TEST_SERVER_LOG (default /tmp/litetraining-test-server.log).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_LOG = process.env.TEST_SERVER_LOG || '/tmp/litetraining-test-server.log';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

function defaultTestDbUrl(): string {
  const user = process.env.PGUSER || os.userInfo().username;
  return `postgresql://${encodeURIComponent(user)}@127.0.0.1:5432/litetraining_test_mcp21`;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitForHealthy(url: string, ms: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`[global-setup] server exited early (${child.exitCode}); see ${SERVER_LOG}`);
    try {
      const res = await fetch(url);
      if (res.ok) {
        const body = (await res.json()) as { database?: string };
        if (body.database === 'connected') return;
      }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`[global-setup] server did not report a connected database at ${url} within ${ms}ms; see ${SERVER_LOG}`);
}

let child: ChildProcess | null = null;

export async function setup(): Promise<void> {
  const dbUrl = process.env.TEST_DATABASE_URL || defaultTestDbUrl();
  const host = new URL(dbUrl).hostname;
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(`[global-setup] Refusing non-local test database host "${host}" — this runner drops every table.`);
  }

  // 1. Wipe. The app bootstraps its own schema at boot when `users` is missing.
  const admin = new pg.Client({ connectionString: dbUrl });
  await admin.connect();
  await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await admin.end();

  // 2. Boot the server from the working tree.
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const log = fs.openSync(SERVER_LOG, 'w');
  child = spawn(path.join(ROOT, 'node_modules', '.bin', 'tsx'), ['server/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      DATABASE_URL: dbUrl,
      DATABASE_SSL: 'false',
      PUBLIC_URL: baseUrl,
      MCP_ACCESS_DISABLED: 'false',
      MANAGER_CODE: 'test-manager-code',
    },
    stdio: ['ignore', log, log],
  });
  await waitForHealthy(`${baseUrl}/api/health`, 90_000, child);

  // Boot must have created the MCP objects through initDatabase — prove it before seeding.
  const db = new pg.Client({ connectionString: dbUrl });
  await db.connect();
  const col = await db.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'agent_scope'");
  if (col.rowCount !== 1) throw new Error('[global-setup] sessions.agent_scope missing after boot');
  for (const table of ['mcp_tokens', 'mcp_audit_log']) {
    const t = await db.query('SELECT 1 FROM information_schema.tables WHERE table_name = $1', [table]);
    if (t.rowCount !== 1) throw new Error(`[global-setup] ${table} missing after boot`);
  }

  // 3. Seed one manager and one trainee, each with a session row (the shape /api/auth/login writes).
  const people = [
    { name: 'Mia Manager', isManager: true },
    { name: 'Theo Trainee', isManager: false },
  ];
  const ids: string[] = [];
  const tokens: string[] = [];
  for (const p of people) {
    const { rows } = await db.query(
      `INSERT INTO users (name, is_manager, last_login) VALUES ($1, $2, NOW()) RETURNING id`,
      [p.name, p.isManager],
    );
    const id = rows[0].id as string;
    await db.query('INSERT INTO user_gamification (user_id, total_xp, current_streak) VALUES ($1, 0, 0)', [id]);
    await db.query("INSERT INTO module_progress (user_id, module_name, status) VALUES ($1, 'welcome', 'unlocked')", [id]);
    const token = crypto.randomBytes(32).toString('hex');
    await db.query(
      'INSERT INTO sessions (user_id, token, expires_at, is_active) VALUES ($1, $2, $3, true)',
      [id, token, new Date(Date.now() + 86_400_000)],
    );
    ids.push(id);
    tokens.push(token);
  }
  await db.end();

  process.env.TEST_BASE_URL = baseUrl;
  process.env.TEST_DATABASE_URL = dbUrl;
  // The loopback test imports server/mcp/loopback.ts INSIDE the worker; its
  // lazy db import needs the same env the spawned server got.
  process.env.DATABASE_URL = dbUrl;
  process.env.DATABASE_SSL = 'false';
  process.env.PORT = String(port);
  process.env.TEST_MANAGER_ID = ids[0];
  process.env.TEST_MANAGER_NAME = people[0].name;
  process.env.TEST_MANAGER_TOKEN = tokens[0];
  process.env.TEST_TRAINEE_ID = ids[1];
  process.env.TEST_TRAINEE_TOKEN = tokens[1];
  console.log(`[global-setup] server up at ${baseUrl} (log: ${SERVER_LOG}), db ${dbUrl}`);
}

export async function teardown(): Promise<void> {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}
