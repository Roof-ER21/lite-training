/**
 * The Lite Training MCP endpoint — mounted at /mcp (server/index.ts).
 *
 * Built on @omj21/mcp21, which owns transport, 401/503, scope enforcement,
 * tools/list filtering, JSON-Schema validation, result rendering and the audit
 * callback. Lite Training owns the three host hooks below:
 *
 *   authenticate — sha256 the bearer, find the live mcp_tokens row, make sure
 *                  the person still exists (the same join requireAuth does),
 *                  stamp last_used_at, hand back a READ-ONLY auth.
 *   audit        — one mcp_audit_log row per tools/call (argument keys only).
 *   disabled     — MCP_ACCESS_DISABLED=true answers 503 before auth.
 *
 * Pass one is read-only regardless of stored scopes: `readOnly: true` hides
 * and refuses every write tool, and the loopback session is 'mcp:read' anyway.
 */

import type { Request } from 'express';
import { createMcp21, hashToken, type Mcp21Auth, type Mcp21AuditEvent } from '@omj21/mcp21';
import { query, queryOne } from '../db/connection.js';
import { MCP_TOOLS } from './tools.js';

export const MCP_TOKEN_PREFIX = 'ltr';
const LAST_USED_STAMP_INTERVAL_MS = 60_000;

/** tokenId → userId, so the audit hook needs no second lookup. */
const tokenOwner = new Map<string, string>();

export function isMcpAccessDisabled(): boolean {
  return process.env.MCP_ACCESS_DISABLED === 'true';
}

type TokenRow = {
  id: string;
  user_id: string;
  scopes: string[] | null;
  last_used_at: Date | null;
  user_name: string;
  user_is_manager: boolean;
};

/** Resolve a bearer token to a read-only auth, or null (→ 401). */
export async function authenticateMcpToken(bearerToken: string): Promise<Mcp21Auth | null> {
  if (typeof bearerToken !== 'string' || bearerToken.length < 16 || bearerToken.length > 512) return null;
  const hash = hashToken(bearerToken);
  const now = new Date();

  // The inner join is the "person still exists" check: a deleted user
  // (DELETE /api/admin/users/:id cascades mcp_tokens too) can never authenticate.
  const row = await queryOne<TokenRow>(
    `SELECT t.id, t.user_id, t.scopes, t.last_used_at, u.name AS user_name, u.is_manager AS user_is_manager
       FROM mcp_tokens t
       JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1
        AND t.revoked_at IS NULL
        AND (t.expires_at IS NULL OR t.expires_at > $2)
      LIMIT 1`,
    [hash, now],
  );
  if (!row) return null;

  if (!row.last_used_at || now.getTime() - new Date(row.last_used_at).getTime() > LAST_USED_STAMP_INTERVAL_MS) {
    query('UPDATE mcp_tokens SET last_used_at = $1 WHERE id = $2', [now, row.id])
      .catch((err: unknown) => console.warn('[mcp] last_used_at stamp failed:', (err as Error).message));
  }

  tokenOwner.set(row.id, row.user_id);

  return {
    principal: {
      id: row.user_id,
      organizationId: 'roof-er',
      label: row.user_name,
      role: row.user_is_manager ? 'manager' : 'trainee',
    },
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
    tokenId: row.id,
    // Pass one: read-only by construction, whatever the stored scopes say.
    readOnly: true,
  };
}

async function ownerFor(event: Mcp21AuditEvent): Promise<string | null> {
  const cached = tokenOwner.get(event.tokenId);
  if (cached) return cached;
  const row = await queryOne<{ user_id: string }>('SELECT user_id FROM mcp_tokens WHERE id = $1', [event.tokenId]);
  if (!row) return null;
  tokenOwner.set(event.tokenId, row.user_id);
  return row.user_id;
}

/** One audit row per tools/call. Keys only — the kit never hands us values. */
export async function auditMcpCall(event: Mcp21AuditEvent): Promise<void> {
  const userId = await ownerFor(event);
  if (!userId) return;
  await query(
    `INSERT INTO mcp_audit_log
       (user_id, token_id, request_id, tool, area, access, argument_keys, ok, error, duration_ms, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      userId,
      event.tokenId,
      event.requestId,
      event.tool,
      event.area,
      event.access,
      [...event.argumentKeys],
      event.ok,
      event.error ? event.error.slice(0, 500) : null,
      Math.round(event.durationMs),
      event.at,
    ],
  );
}

/** Rate-limit key: the sha256 of the bearer (never the bearer). Empty when there is none. */
export function mcpRateLimitKey(req: Request): string {
  const header = req.headers.authorization;
  const match = typeof header === 'string' ? /^\s*Bearer\s+(\S+)\s*$/i.exec(header) : null;
  return match ? `tok:${hashToken(match[1])}` : '';
}

export function createLiteTrainingMcpServer() {
  return createMcp21({
    name: 'lite-training',
    version: process.env.npm_package_version || '1.0.0',
    tools: MCP_TOOLS,
    authenticate: authenticateMcpToken,
    audit: auditMcpCall,
    disabled: isMcpAccessDisabled,
    maxBodyBytes: 256 * 1024,
  });
}

/** Rows written for one token, newest first — used by tests and (later) a "recent activity" view. */
export async function recentAuditForToken(tokenId: string, limit = 50) {
  return query(
    'SELECT * FROM mcp_audit_log WHERE token_id = $1 ORDER BY created_at DESC LIMIT $2',
    [tokenId, limit],
  );
}
