/**
 * Personal agent tokens — "Connected agents" on My Page.
 *
 *   GET    /api/mcp/tokens/areas  → the areas THIS person may mint, the endpoint URL
 *   GET    /api/mcp/tokens        → the caller's own tokens (hint + scopes, never the hash)
 *   POST   /api/mcp/tokens        { name, scopes: string[], expiresInDays? }
 *                                 → the plaintext token ONCE, plus hint
 *   DELETE /api/mcp/tokens/:id    → revoke (own token; managers may revoke anyone's)
 *
 * Pass one is reads only: a ":write" scope is refused in a plain sentence, and
 * an area outside the caller's role is refused by name (server/mcp/areas.ts).
 * A token is bound to the person who minted it and acts as them over /mcp.
 * A loopback session (agent_scope 'mcp:read') cannot reach these routes at
 * all — not even the list.
 */

import { Router, type Request, type Response } from 'express';
import { generateToken } from '@omj21/mcp21';
import { query, queryOne } from '../db/connection.js';
import { requireAuth, MCP_READ_SCOPE } from '../middleware/auth.js';
import { MCP_AREAS, MCP_AREA_LABELS, userCanMintArea, validateRequestedScopes } from '../mcp/areas.js';
import { MCP_TOKEN_PREFIX } from '../mcp/server.js';

// The URL agents connect to — the public origin. PUBLIC_URL wins so a
// self-host or preview controls the domain.
const APP_URL = (process.env.PUBLIC_URL || process.env.APP_URL || 'https://a21.up.railway.app').replace(/\/+$/, '');

export const MCP_ENDPOINT_URL = `${APP_URL}/mcp`;
const MAX_NAME = 80;
const MAX_EXPIRY_DAYS = 365;

type McpTokenRow = {
  id: string;
  user_id: string;
  name: string;
  token_hint: string;
  scopes: string[];
  expires_at: Date | null;
  last_used_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
};

const PRESENT_COLUMNS = 'id, user_id, name, token_hint, scopes, expires_at, last_used_at, revoked_at, created_at';

function present(row: McpTokenRow) {
  return {
    id: row.id,
    name: row.name,
    hint: row.token_hint,
    scopes: row.scopes,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

const router = Router();
router.use(requireAuth);

// An agent's loopback session must not manage tokens — even reads of this list.
router.use((req: Request, res: Response, next) => {
  if (req.agentScope === MCP_READ_SCOPE) {
    return res.status(403).json({ error: 'Read-only agent token.' });
  }
  next();
});

router.get('/areas', (req: Request, res: Response) => {
  const user = req.user!;
  res.json({
    endpoint: MCP_ENDPOINT_URL,
    readOnly: true,
    areas: MCP_AREAS.map((area) => ({
      area,
      scope: `${area}:read`,
      label: MCP_AREA_LABELS[area].label,
      description: MCP_AREA_LABELS[area].description,
      allowed: userCanMintArea(user, area),
    })),
  });
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const rows = await query<McpTokenRow>(
      `SELECT ${PRESENT_COLUMNS} FROM mcp_tokens
        WHERE user_id = $1 AND revoked_at IS NULL
        ORDER BY created_at DESC`,
      [req.user!.id],
    );
    res.json({ tokens: rows.map(present), endpoint: MCP_ENDPOINT_URL });
  } catch (err) {
    console.error('[mcp-tokens] GET failed:', (err as Error).message);
    res.status(500).json({ error: 'Could not load agent tokens' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { name?: unknown; scopes?: unknown; expiresInDays?: unknown };

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > MAX_NAME) {
    return res.status(400).json({ error: `Give the token a name (1-${MAX_NAME} characters), such as the agent that will use it.` });
  }

  const validated = validateRequestedScopes(req.user, body.scopes);
  if (!validated.ok) return res.status(400).json({ error: validated.error });

  let expiresAt: Date | null = null;
  if (body.expiresInDays !== undefined && body.expiresInDays !== null && body.expiresInDays !== '') {
    const days = Number(body.expiresInDays);
    if (!Number.isInteger(days) || days < 1 || days > MAX_EXPIRY_DAYS) {
      return res.status(400).json({ error: `expiresInDays must be a whole number from 1 to ${MAX_EXPIRY_DAYS}.` });
    }
    expiresAt = new Date(Date.now() + days * 86_400_000);
  }

  try {
    const { token, hash, hint } = generateToken(MCP_TOKEN_PREFIX);
    const row = await queryOne<McpTokenRow>(
      `INSERT INTO mcp_tokens (user_id, name, token_hash, token_hint, scopes, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${PRESENT_COLUMNS}`,
      [req.user!.id, name, hash, hint, validated.scopes, expiresAt],
    );
    if (!row) throw new Error('insert returned no row');
    // The plaintext leaves the server exactly once, here. It is not logged.
    res.status(201).json({ ...present(row), token, endpoint: MCP_ENDPOINT_URL, readOnly: true });
  } catch (err) {
    console.error('[mcp-tokens] POST failed:', (err as Error).message);
    res.status(500).json({ error: 'Could not create the agent token' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid token id' });
  try {
    const row = await queryOne<McpTokenRow>(`SELECT ${PRESENT_COLUMNS} FROM mcp_tokens WHERE id = $1`, [id]);
    const ownsIt = row && row.user_id === req.user!.id;
    if (!row || (!ownsIt && !req.user!.isManager)) {
      return res.status(404).json({ error: 'Token not found' });
    }
    if (row.revoked_at) {
      return res.json({ ...present(row), alreadyRevoked: true });
    }
    const updated = await queryOne<McpTokenRow>(
      `UPDATE mcp_tokens SET revoked_at = NOW() WHERE id = $1 RETURNING ${PRESENT_COLUMNS}`,
      [id],
    );
    res.json(present(updated ?? row));
  } catch (err) {
    console.error('[mcp-tokens] DELETE failed:', (err as Error).message);
    res.status(500).json({ error: 'Could not revoke the agent token' });
  }
});

export default router;
