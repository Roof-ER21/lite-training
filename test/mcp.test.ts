/**
 * MCP pass one, end to end against the booted test server (test/global-setup.ts):
 *
 *   - the seeded manager mints a personal agent token (writes refused, unknown
 *     areas refused, out-of-role areas refused by name for a trainee,
 *     plaintext shown once, list shows hint only)
 *   - a real MCP client (SDK Client + StreamableHTTPClientTransport) connects
 *     to /mcp with it, lists only the scoped tools, calls `me` and
 *     `my_progress` and gets the route's own JSON, and is refused in plain
 *     words for an unknown argument and for an unscoped tool
 *   - the loopback SESSION (agent_scope 'mcp:read') reads but cannot POST —
 *     403 "Read-only agent token." — on a requireAuth route, on a
 *     requireManager route, and on the token routes; /api/auth/validate never
 *     accepts it as a login; its expiry is untouched by a read; it is deleted
 *     after the call
 *   - revoke → 401; no token → 401; another person cannot revoke it
 *   - mcp_audit_log has a row per call with argument KEYS and no values
 *   - the per-token limiter answers 429 past 120 requests in a minute
 *   - MCP_ACCESS_DISABLED=true → 503 is proven by the smoke boot (not here:
 *     the flag is read at request time from this server's env)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const BASE_URL = process.env.TEST_BASE_URL!;
const TEST_DB = process.env.TEST_DATABASE_URL!;
const MANAGER_ID = process.env.TEST_MANAGER_ID!;
const MANAGER_NAME = process.env.TEST_MANAGER_NAME!;
const MANAGER_TOKEN = process.env.TEST_MANAGER_TOKEN!;
const TRAINEE_ID = process.env.TEST_TRAINEE_ID!;
const TRAINEE_TOKEN = process.env.TEST_TRAINEE_TOKEN!;

async function api(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

/** A raw JSON-RPC initialize POST — enough to see the transport's status code. */
async function rawMcp(bearer?: string) {
  return fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'raw', version: '0' } },
    }),
  });
}

async function connect(bearer: string): Promise<Client> {
  const client = new Client({ name: 'vitest-mcp', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  await client.connect(transport);
  return client;
}

function firstText(result: any): string {
  const block = Array.isArray(result?.content) ? result.content.find((c: any) => c.type === 'text') : null;
  return block?.text ?? '';
}

let db: pg.Pool;
let mintedId = '';
let mintedToken = '';
const SECRET_VALUE = 'zz-never-in-audit-9f3c';

beforeAll(async () => {
  expect(BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  db = new pg.Pool({ connectionString: TEST_DB });
  const me = await api('GET', '/api/auth/me', undefined, MANAGER_TOKEN);
  expect(me.status).toBe(200);
  expect(me.json.id).toBe(MANAGER_ID);
  expect(me.json.isManager).toBe(true);
});

afterAll(async () => {
  await db.end();
});

describe('POST /api/mcp/tokens — minting', () => {
  it('lists the areas this person may mint, all read-only, with the endpoint', async () => {
    const res = await api('GET', '/api/mcp/tokens/areas', undefined, MANAGER_TOKEN);
    expect(res.status).toBe(200);
    expect(res.json.readOnly).toBe(true);
    expect(res.json.endpoint).toBe(`${BASE_URL}/mcp`);
    expect(res.json.areas.map((a: any) => a.area)).toEqual(['me', 'progress', 'exam', 'roleplay', 'content', 'admin']);
    expect(res.json.areas.every((a: any) => a.scope.endsWith(':read'))).toBe(true);
    expect(res.json.areas.every((a: any) => a.allowed === true)).toBe(true);
  });

  it('tells a trainee which area their role does not reach', async () => {
    const res = await api('GET', '/api/mcp/tokens/areas', undefined, TRAINEE_TOKEN);
    expect(res.status).toBe(200);
    const byArea = Object.fromEntries(res.json.areas.map((a: any) => [a.area, a.allowed]));
    expect(byArea.me).toBe(true);
    expect(byArea.progress).toBe(true);
    expect(byArea.admin).toBe(false);
  });

  it('refuses a write scope in a plain sentence', async () => {
    const res = await api('POST', '/api/mcp/tokens', { name: 'writer', scopes: ['progress:write'] }, MANAGER_TOKEN);
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/not enabled yet/i);
  });

  it('refuses an unknown area by name', async () => {
    const res = await api('POST', '/api/mcp/tokens', { name: 'nope', scopes: ['cms:read'] }, MANAGER_TOKEN);
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/Unknown scope: cms:read/);
  });

  it('refuses an area outside the caller\'s role by name', async () => {
    const res = await api('POST', '/api/mcp/tokens', { name: 'reach', scopes: ['me:read', 'admin:read'] }, TRAINEE_TOKEN);
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/does not have access to: admin/);
  });

  it('requires a name', async () => {
    const res = await api('POST', '/api/mcp/tokens', { scopes: ['progress:read'] }, MANAGER_TOKEN);
    expect(res.status).toBe(400);
  });

  it('mints a token: plaintext once, hint = last four, only the requested read scopes', async () => {
    const res = await api('POST', '/api/mcp/tokens', {
      name: 'vitest agent', scopes: ['progress:read', 'me:read', 'progress:read', 'exam:read'], expiresInDays: 30,
    }, MANAGER_TOKEN);
    expect(res.status).toBe(201);
    expect(res.json.token).toMatch(/^ltr_[0-9A-Za-z]{20,}$/);
    expect(res.json.hint).toBe(res.json.token.slice(-4));
    expect(res.json.scopes).toEqual(['progress:read', 'me:read', 'exam:read']);
    expect(res.json.readOnly).toBe(true);
    expect(res.json.expiresAt).toBeTruthy();
    expect(res.json.tokenHash).toBeUndefined();
    expect(res.json.token_hash).toBeUndefined();
    mintedId = res.json.id;
    mintedToken = res.json.token;
  });

  it('stores only the hash', async () => {
    const { rows } = await db.query('SELECT token_hash, token_hint FROM mcp_tokens WHERE id = $1', [mintedId]);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].token_hash).not.toContain(mintedToken);
    expect(rows[0].token_hint).toBe(mintedToken.slice(-4));
  });

  it('the list shows the hint and scopes, never the token or its hash', async () => {
    const res = await api('GET', '/api/mcp/tokens', undefined, MANAGER_TOKEN);
    expect(res.status).toBe(200);
    const row = res.json.tokens.find((t: any) => t.id === mintedId);
    expect(row).toBeTruthy();
    expect(row.hint).toBe(mintedToken.slice(-4));
    expect(row.scopes).toEqual(['progress:read', 'me:read', 'exam:read']);
    expect(JSON.stringify(res.json)).not.toContain(mintedToken);
    expect(JSON.stringify(res.json)).not.toMatch(/tokenHash|token_hash/);
  });

  it('another person does not see it and cannot revoke it', async () => {
    const list = await api('GET', '/api/mcp/tokens', undefined, TRAINEE_TOKEN);
    expect(list.status).toBe(200);
    expect(list.json.tokens.some((t: any) => t.id === mintedId)).toBe(false);
    const del = await api('DELETE', `/api/mcp/tokens/${mintedId}`, undefined, TRAINEE_TOKEN);
    expect(del.status).toBe(404);
  });
});

describe('/mcp — a real MCP client acting as the person', () => {
  it('rejects a request with no token', async () => {
    const res = await rawMcp();
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/Bearer/);
  });

  it('rejects a token that does not exist', async () => {
    const res = await rawMcp('ltr_thisIsNotARealToken00000000000000000000');
    expect(res.status).toBe(401);
  });

  it('lists only the tools in the scoped areas', async () => {
    const client = await connect(mintedToken);
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toContain('me');
      expect(names).toContain('my_badges');
      expect(names).toContain('my_progress');
      expect(names).toContain('leaderboard');
      expect(names).toContain('my_exam_history');
      expect(names).toContain('exam_attempt_answers');
      expect(names).not.toContain('my_roleplay_history');
      expect(names).not.toContain('content_modules');
      expect(names).not.toContain('admin_users');
      // The kit hardens every schema: unknown arguments are refused.
      expect(tools.every((t) => (t.inputSchema as any).additionalProperties === false)).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('`me` and `my_progress` return exactly what the app itself returns for this person', async () => {
    const client = await connect(mintedToken);
    try {
      const me: any = await client.callTool({ name: 'me', arguments: {} });
      expect(me.isError).toBeFalsy();
      const meJson = JSON.parse(firstText(me));
      expect(meJson.id).toBe(MANAGER_ID);
      expect(meJson.name).toBe(MANAGER_NAME);
      expect(me.structuredContent).toBeTypeOf('object');
      const direct = await api('GET', '/api/auth/me', undefined, MANAGER_TOKEN);
      expect(Object.keys(meJson).sort()).toEqual(Object.keys(direct.json).sort());

      const progress: any = await client.callTool({ name: 'my_progress', arguments: {} });
      expect(progress.isError).toBeFalsy();
      const progressJson = JSON.parse(firstText(progress));
      const directProgress = await api('GET', '/api/progress', undefined, MANAGER_TOKEN);
      expect(progressJson).toEqual(directProgress.json);
      expect(progressJson.modules.map((m: any) => m.name)).toContain('welcome');

      const board: any = await client.callTool({ name: 'leaderboard', arguments: { type: 'alltime' } });
      expect(board.isError).toBeFalsy();
      expect(JSON.parse(firstText(board)).type).toBe('alltime');
    } finally {
      await client.close();
    }
  });

  it('refuses an unknown argument in plain words, and an unscoped tool by scope name', async () => {
    const client = await connect(mintedToken);
    try {
      const bad: any = await client.callTool({
        name: 'exam_attempt_answers', arguments: { attemptId: '00000000-0000-0000-0000-000000000000', bogus: SECRET_VALUE },
      });
      expect(bad.isError).toBe(true);
      expect(firstText(bad)).toBe('Unknown argument "bogus".');
      expect(firstText(bad)).not.toContain(SECRET_VALUE);

      const badEnum: any = await client.callTool({ name: 'leaderboard', arguments: { type: 'yearly' } });
      expect(badEnum.isError).toBe(true);

      const unscoped: any = await client.callTool({ name: 'admin_users', arguments: {} });
      expect(unscoped.isError).toBe(true);
      expect(firstText(unscoped)).toMatch(/no admin:read scope/);
    } finally {
      await client.close();
    }
  });

  it('leaves no loopback session behind', async () => {
    const { rows } = await db.query("SELECT count(*)::int AS n FROM sessions WHERE agent_scope = 'mcp:read'");
    expect(rows[0].n).toBe(0);
  });

  it('writes one audit row per call with argument keys and never values', async () => {
    const { rows } = await db.query(
      `SELECT tool, area, access, argument_keys, ok, error, user_id
         FROM mcp_audit_log WHERE token_id = $1 ORDER BY created_at ASC`,
      [mintedId],
    );
    const tools = rows.map((r: any) => r.tool);
    expect(tools).toContain('me');
    expect(tools).toContain('my_progress');
    expect(tools).toContain('admin_users');

    const okMe = rows.find((r: any) => r.tool === 'me' && r.ok);
    expect(okMe.argument_keys).toEqual([]);
    expect(okMe.area).toBe('me');
    expect(okMe.access).toBe('read');
    expect(okMe.user_id).toBe(MANAGER_ID);

    const okBoard = rows.find((r: any) => r.tool === 'leaderboard' && r.ok);
    expect(okBoard.argument_keys).toEqual(['type']);
    // The VALUES sent ('alltime', 'yearly') never reach audit: keys only, and the
    // kit's refusal names the allowed enum, not what was sent.
    expect(rows.every((r: any) => !r.argument_keys.includes('alltime') && !r.argument_keys.includes('yearly'))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('yearly');
    const badBoard = rows.find((r: any) => r.tool === 'leaderboard' && !r.ok);
    expect(badBoard.error).toMatch(/invalid arguments/);

    const refused = rows.find((r: any) => r.tool === 'exam_attempt_answers' && !r.ok);
    expect(refused.argument_keys.sort()).toEqual(['attemptId', 'bogus']);
    expect(JSON.stringify(rows)).not.toContain(SECRET_VALUE);

    const unscoped = rows.find((r: any) => r.tool === 'admin_users');
    expect(unscoped.ok).toBe(false);
    expect(unscoped.error).toMatch(/missing scope admin:read/);
  });
});

describe('the loopback session — reads yes, writes never, login never', () => {
  let withLoopbackSession: typeof import('../server/mcp/loopback.js').withLoopbackSession;

  beforeAll(async () => {
    ({ withLoopbackSession } = await import('../server/mcp/loopback.js'));
  });

  it('authenticates a GET as the person and leaves the 5-minute expiry untouched', async () => {
    await withLoopbackSession(MANAGER_ID, async (bearer) => {
      const before = await db.query('SELECT expires_at, agent_scope FROM sessions WHERE token = $1', [bearer]);
      expect(before.rowCount).toBe(1);
      expect(before.rows[0].agent_scope).toBe('mcp:read');
      const res = await api('GET', '/api/auth/me', undefined, bearer);
      expect(res.status).toBe(200);
      expect(res.json.id).toBe(MANAGER_ID);
      const after = await db.query('SELECT expires_at FROM sessions WHERE token = $1', [bearer]);
      const expiresAt = new Date(after.rows[0].expires_at).getTime();
      expect(expiresAt).toBe(new Date(before.rows[0].expires_at).getTime());
      // sessions.expires_at is `timestamp` (no zone); node-pg wrote and read it the same way.
      expect(expiresAt).toBeLessThan(Date.now() + 6 * 60_000);
      expect(expiresAt).toBeGreaterThan(Date.now() + 4 * 60_000);
    });
  });

  it('is refused on POST through requireAuth (server/middleware/auth.ts)', async () => {
    await withLoopbackSession(MANAGER_ID, async (bearer) => {
      const res = await api('POST', '/api/progress/module', { moduleName: 'welcome', status: 'completed' }, bearer);
      expect(res.status).toBe(403);
      expect(res.json).toEqual({ error: 'Read-only agent token.' });
      const logout = await api('POST', '/api/auth/logout', {}, bearer);
      expect(logout.status).toBe(403);
    });
    const untouched = await db.query("SELECT status FROM module_progress WHERE user_id = $1 AND module_name = 'welcome'", [MANAGER_ID]);
    expect(untouched.rows[0].status).toBe('unlocked');
  });

  it('is refused on a manager write route before requireManager runs', async () => {
    await withLoopbackSession(MANAGER_ID, async (bearer) => {
      const res = await api('POST', `/api/admin/users/${TRAINEE_ID}/unlock-all-modules`, {}, bearer);
      expect(res.status).toBe(403);
      expect(res.json).toEqual({ error: 'Read-only agent token.' });
      const read = await api('GET', '/api/admin/users', undefined, bearer);
      expect(read.status).toBe(200);
    });
  });

  it('is never a login: /api/auth/validate answers valid:false', async () => {
    await withLoopbackSession(MANAGER_ID, async (bearer) => {
      const res = await api('POST', '/api/auth/validate', { token: bearer });
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ valid: false });
    });
  });

  it('cannot manage tokens at all — not even list them', async () => {
    await withLoopbackSession(MANAGER_ID, async (bearer) => {
      const mint = await api('POST', '/api/mcp/tokens', { name: 'escalate', scopes: ['progress:read'] }, bearer);
      expect(mint.status).toBe(403);
      const list = await api('GET', '/api/mcp/tokens', undefined, bearer);
      expect(list.status).toBe(403);
      expect(list.json).toEqual({ error: 'Read-only agent token.' });
    });
  });

  it('is deleted after the call, even when the call throws', async () => {
    let bearerSeen = '';
    await expect(withLoopbackSession(MANAGER_ID, async (bearer) => {
      bearerSeen = bearer;
      throw new Error('boom');
    })).rejects.toThrow('boom');
    const { rows } = await db.query('SELECT 1 FROM sessions WHERE token = $1', [bearerSeen]);
    expect(rows.length).toBe(0);
  });
});

describe('rate limit and revoke', () => {
  it('answers 429 once a token passes 120 requests in a minute', async () => {
    // A bogus bearer: the limiter keys on the bearer's hash and runs before auth,
    // so this never touches the real token's budget.
    const bogus = 'ltr_rateLimitProbe000000000000000000000000';
    const statuses: number[] = [];
    for (let i = 0; i < 125; i++) {
      const res = await rawMcp(bogus);
      statuses.push(res.status);
      await res.text();
    }
    expect(statuses.slice(0, 100).every((s) => s === 401)).toBe(true);
    expect(statuses[statuses.length - 1]).toBe(429);
  }, 60_000);

  it('revoke → the very next MCP request is 401', async () => {
    const before = await rawMcp(mintedToken);
    expect(before.status).toBe(200);
    await before.text();

    const del = await api('DELETE', `/api/mcp/tokens/${mintedId}`, undefined, MANAGER_TOKEN);
    expect(del.status).toBe(200);
    expect(del.json.revokedAt).toBeTruthy();

    const after = await rawMcp(mintedToken);
    expect(after.status).toBe(401);

    const list = await api('GET', '/api/mcp/tokens', undefined, MANAGER_TOKEN);
    expect(list.json.tokens.some((t: any) => t.id === mintedId)).toBe(false);
  });

  it('a trainee\'s token acts as the trainee: own rows, and the admin tools are not offered', async () => {
    const mint = await api('POST', '/api/mcp/tokens', { name: 'trainee agent', scopes: ['me:read', 'roleplay:read'] }, TRAINEE_TOKEN);
    expect(mint.status).toBe(201);
    const client = await connect(mint.json.token);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).not.toContain('admin_users');
      const me: any = await client.callTool({ name: 'me', arguments: {} });
      expect(JSON.parse(firstText(me)).id).toBe(TRAINEE_ID);
      const history: any = await client.callTool({ name: 'my_roleplay_history', arguments: {} });
      expect(history.isError).toBeFalsy();
      expect(JSON.parse(firstText(history)).sessions).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it('a deleted person\'s token stops working without a revoke', async () => {
    const { rows } = await db.query("INSERT INTO users (name, is_manager) VALUES ('Gone Person', false) RETURNING id");
    const goneId = rows[0].id as string;
    const session = 'gone-' + goneId;
    await db.query('INSERT INTO sessions (user_id, token, expires_at, is_active) VALUES ($1, $2, $3, true)', [goneId, session, new Date(Date.now() + 86_400_000)]);
    const mint = await api('POST', '/api/mcp/tokens', { name: 'gone agent', scopes: ['me:read'] }, session);
    expect(mint.status).toBe(201);
    const ok = await rawMcp(mint.json.token);
    expect(ok.status).toBe(200);
    await ok.text();
    await db.query('DELETE FROM users WHERE id = $1', [goneId]);
    const gone = await rawMcp(mint.json.token);
    expect(gone.status).toBe(401);
  });
});
