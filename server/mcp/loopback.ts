/**
 * Loopback — how every MCP tool reads Lite Training.
 *
 * A tool never queries the database. It calls the app's own HTTP route on
 * 127.0.0.1 (the port this process listens on) AS the token's person. Lite
 * Training has no JWT: `requireAuth` looks a bearer up in the `sessions`
 * table. So for each tool call this module:
 *
 *   1. inserts a session row for the person with `agent_scope = 'mcp:read'`,
 *      a random token and `expires_at = now + 5 minutes`,
 *   2. GETs the route with that bearer,
 *   3. deletes the row again (finally — a crash cannot leave it behind for
 *      longer than the five minutes).
 *
 * Two things follow from that, and they are the whole design:
 *
 *   - The route applies the app's own authorization (requireAuth,
 *     requireManager, the own-or-manager checks inside exam/roleplay). A tool
 *     returns exactly what that person can already see in the app. Nothing
 *     here re-implements scoping.
 *   - `agent_scope = 'mcp:read'` is the ceiling: requireAuth refuses such a
 *     session on any non-GET/HEAD request and /api/auth/validate never
 *     accepts it as a login, so a read token cannot write even through a bug
 *     in a tool.
 *
 * Nothing from the MCP request is forwarded except the validated arguments,
 * and only the query params each tool whitelists. Nothing is cached across
 * calls except the user lookup (60 s).
 */

import crypto from 'crypto';
import type { Mcp21Context, Mcp21Result } from '@omj21/mcp21';
import { MCP_READ_SCOPE } from './scope.js';

export const LOOPBACK_TIMEOUT_MS = 15_000;
export const LOOPBACK_SESSION_TTL_MS = 5 * 60_000;
const USER_CACHE_TTL_MS = 60_000;

export type LoopbackUser = { id: string; name: string; isManager: boolean };

/** Same env the server listens on (server/index.ts: PORT || 3000). */
export function loopbackBaseUrl(): string {
  const port = parseInt(process.env.PORT || '3000', 10);
  return `http://127.0.0.1:${port}`;
}

const userCache = new Map<string, { user: LoopbackUser | null; at: number }>();

/** The token's user, if the row still exists. Cached briefly; the routes re-check on every call anyway. */
export async function resolveLoopbackUser(userId: string): Promise<LoopbackUser | null> {
  const hit = userCache.get(userId);
  const now = Date.now();
  if (hit && now - hit.at < USER_CACHE_TTL_MS) return hit.user;
  // Lazy so the tool registry (and its unit tests) load without touching the pool.
  const { queryOne } = await import('../db/connection.js');
  const row = await queryOne<{ id: string; name: string; is_manager: boolean }>(
    'SELECT id, name, is_manager FROM users WHERE id = $1',
    [userId],
  );
  const user: LoopbackUser | null = row ? { id: row.id, name: row.name, isManager: row.is_manager === true } : null;
  userCache.set(userId, { user, at: now });
  return user;
}

export function invalidateLoopbackUserCache(userId?: string): void {
  if (userId) userCache.delete(userId);
  else userCache.clear();
}

/**
 * Run `fn` with a short-lived read-only session for the person, then delete
 * the row. Exported for the integration test, which proves such a session
 * cannot POST.
 *
 * expires_at is written as a JS Date exactly the way /api/auth/login writes
 * it (sessions.expires_at is `timestamp` without a zone; node-pg serialises
 * and parses it the same way on both ends, which is what requireAuth relies on).
 */
export async function withLoopbackSession<T>(userId: string, fn: (bearer: string) => Promise<T>): Promise<T> {
  const { query, queryOne } = await import('../db/connection.js');
  const token = `mcpsess_${crypto.randomBytes(32).toString('base64url')}`;
  const row = await queryOne<{ id: string }>(
    `INSERT INTO sessions (user_id, token, expires_at, is_active, agent_scope)
     VALUES ($1, $2, $3, true, $4)
     RETURNING id`,
    [userId, token, new Date(Date.now() + LOOPBACK_SESSION_TTL_MS), MCP_READ_SCOPE],
  );
  if (!row) throw new Error('loopback session insert returned no row');
  try {
    return await fn(token);
  } finally {
    await query('DELETE FROM sessions WHERE id = $1', [row.id]).catch((err: unknown) => {
      console.warn('[mcp] loopback session cleanup failed (expires in 5 min anyway):', (err as Error).message);
    });
  }
}

/** A path segment from a tool argument: encoded, never empty, never a path escape. */
export function segment(value: unknown): string | null {
  const s = String(value ?? '').trim();
  if (!s || s.length > 128 || s.includes('/') || s.includes('\\') || s === '.' || s === '..') return null;
  return encodeURIComponent(s);
}

function queryFrom(args: Record<string, unknown>, allowed: readonly string[]): URLSearchParams {
  const qs = new URLSearchParams();
  for (const key of allowed) {
    const value = args[key];
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) qs.set(key, value.map((v) => String(v)).join(','));
    else qs.set(key, String(value));
  }
  return qs;
}

function plainRefusal(status: number, body: unknown): string {
  const b = (body ?? {}) as { error?: unknown; message?: unknown };
  const detail = typeof b.message === 'string' ? b.message : typeof b.error === 'string' ? b.error : '';
  if (status === 401) return "Lite Training did not accept this token's session; try again in a moment.";
  if (status === 403) return `This person is not allowed to see that in Lite Training${detail ? `: ${detail}` : '.'}`;
  if (status === 404) return `Not found${detail ? `: ${detail}` : '.'}`;
  if (status === 400) return `Lite Training refused the request${detail ? `: ${detail}` : '.'}`;
  if (status === 429) return 'Lite Training is rate limiting this person right now; try again shortly.';
  if (status === 503) return 'Lite Training cannot reach its database right now; try again shortly.';
  return `Lite Training could not answer (HTTP ${status})${detail ? `: ${detail}` : '.'}`;
}

export type LoopbackOptions = {
  /** Route path, already containing any encoded path segments, e.g. `/api/exam/answers/${id}` */
  path: string;
  /** The tool's validated arguments. */
  args: Record<string, unknown>;
  /** Query params this tool may forward (the route's real params — nothing else reaches the URL). */
  query?: readonly string[];
  /** Extra fixed query params. */
  fixedQuery?: Record<string, string>;
  /** Project the route's JSON before returning it. */
  pick?: (json: unknown) => unknown;
};

/** GET one of Lite Training's own routes as the token's person. Returns `{ json }` or a plain-sentence `isError`. */
export async function loopbackGet(context: Mcp21Context, options: LoopbackOptions): Promise<Mcp21Result> {
  const user = await resolveLoopbackUser(context.auth.principal.id);
  if (!user) {
    return { isError: true, text: 'The person behind this token no longer exists in Lite Training.' };
  }

  const qs = queryFrom(options.args, options.query ?? []);
  for (const [k, v] of Object.entries(options.fixedQuery ?? {})) qs.set(k, v);
  const suffix = qs.toString();
  const url = `${loopbackBaseUrl()}${options.path}${suffix ? `?${suffix}` : ''}`;

  const timeout = AbortSignal.timeout(LOOPBACK_TIMEOUT_MS);
  const signal = AbortSignal.any([context.signal, timeout]);

  return withLoopbackSession(user.id, async (bearer) => {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${bearer}`,
          Accept: 'application/json',
          'X-Request-Id': context.requestId,
        },
        signal,
      });
    } catch (err) {
      if (timeout.aborted) return { isError: true, text: 'Lite Training took longer than 15 seconds to answer; try a narrower request.' };
      if (context.signal.aborted) return { isError: true, text: 'The request was cancelled.' };
      const reason = err instanceof Error ? err.message : String(err);
      return { isError: true, text: `Lite Training could not be reached over loopback (${reason}).` };
    }

    let body: unknown = null;
    const raw = await res.text();
    if (raw) {
      try { body = JSON.parse(raw); } catch { body = null; }
    }
    if (!res.ok) {
      return { isError: true, text: plainRefusal(res.status, body) };
    }
    if (body === null && raw) {
      return { isError: true, text: 'Lite Training answered with something other than JSON.' };
    }
    return { json: options.pick ? options.pick(body) : body };
  });
}
