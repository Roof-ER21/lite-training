import { Request, Response, NextFunction } from 'express';
import { query, queryOne, isDatabaseAvailable } from '../db/connection.js';
import { MCP_READ_SCOPE } from '../mcp/scope.js';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        name: string;
        isManager: boolean;
      };
      /** sessions.agent_scope of the session behind req.user — null for a normal login. */
      agentScope?: string | null;
    }
  }
}

// ─── Read-only agent sessions (MCP) ───────────────────────────────────────────
//
// An MCP tool never queries the database; it calls the app's own routes over
// loopback with a 5-minute session row whose `agent_scope` is 'mcp:read'
// (server/mcp/loopback.ts). That value is the ceiling: such a session is
// refused on any request that is not GET/HEAD — here in requireAuth (every
// authenticated route in this app goes through it) — and /api/auth/validate
// never accepts it as a login. This app has no sliding renewal to switch off.

export { MCP_READ_SCOPE };

type SessionLike = { agent_scope?: string | null } | null | undefined;

export function isReadOnlyAgentSession(session: SessionLike): boolean {
  return session?.agent_scope === MCP_READ_SCOPE;
}

/**
 * Refuse a write attempted through a read-only agent session. Returns true when
 * the response has been sent (the caller must stop).
 */
export function refuseReadOnlyAgentWrite(session: SessionLike, req: Request, res: Response): boolean {
  if (!isReadOnlyAgentSession(session)) return false;
  if (req.method === 'GET' || req.method === 'HEAD') return false;
  res.status(403).json({ error: 'Read-only agent token.' });
  return true;
}

// Validate session token and attach user to request
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    // Offline tokens are a degraded-mode escape hatch, valid ONLY while the
    // database is actually down — otherwise they'd be a free impersonation
    // vector (anyone could send "offline-<uuid>" and act as that user).
    if (token.startsWith('offline-')) {
      if (isDatabaseAvailable()) {
        return res.status(401).json({ error: 'Invalid token' });
      }
      const userId = token.replace('offline-', '');
      req.user = {
        id: userId,
        name: 'Offline User',
        isManager: false // Offline mode doesn't have manager access
      };
      return next();
    }

    // If database isn't available, we can't validate real tokens
    if (!isDatabaseAvailable()) {
      return res.status(503).json({ error: 'Database unavailable', offline: true });
    }

    // Find session and user
    const session = await queryOne<{
      user_id: string;
      name: string;
      is_manager: boolean;
      is_active: boolean;
      expires_at: Date;
      agent_scope: string | null;
    }>(`
      SELECT s.user_id, s.is_active, s.expires_at, s.agent_scope, u.name, u.is_manager
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = $1
    `, [token]);

    if (!session) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    if (!session.is_active) {
      return res.status(401).json({ error: 'Session expired' });
    }

    if (session.expires_at && new Date(session.expires_at) < new Date()) {
      // Mark session as inactive
      await query('UPDATE sessions SET is_active = false WHERE token = $1', [token]);
      return res.status(401).json({ error: 'Session expired' });
    }

    // A read-only agent session (MCP loopback) reads as the person and nothing
    // else. Routes still apply their own authorization to req.user below.
    if (refuseReadOnlyAgentWrite(session, req, res)) return;

    // Attach user to request
    req.user = {
      id: session.user_id,
      name: session.name,
      isManager: session.is_manager
    };
    req.agentScope = session.agent_scope ?? null;

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
}

// Require manager role
export function requireManager(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!req.user.isManager) {
    return res.status(403).json({ error: 'Manager access required' });
  }

  next();
}

// Optional auth - attaches user if token present, but doesn't require it
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];

    // Offline tokens only count while the database is actually down
    // (same rule as requireAuth — otherwise they allow impersonation).
    if (token.startsWith('offline-')) {
      if (!isDatabaseAvailable()) {
        const userId = token.replace('offline-', '');
        req.user = {
          id: userId,
          name: 'Offline User',
          isManager: false
        };
      }
      return next();
    }

    // Skip DB lookup if database isn't available
    if (!isDatabaseAvailable()) {
      return next();
    }

    const session = await queryOne<{
      user_id: string;
      name: string;
      is_manager: boolean;
      is_active: boolean;
      agent_scope: string | null;
    }>(`
      SELECT s.user_id, s.is_active, s.agent_scope, u.name, u.is_manager
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = $1 AND s.is_active = true
    `, [token]);

    if (session) {
      // Same ceiling as requireAuth: an agent session never writes.
      if (refuseReadOnlyAgentWrite(session, req, res)) return;
      req.user = {
        id: session.user_id,
        name: session.name,
        isManager: session.is_manager
      };
      req.agentScope = session.agent_scope ?? null;
    }

    next();
  } catch (error) {
    // Don't fail on optional auth errors
    next();
  }
}
