import { Request, Response, NextFunction } from 'express';
import { query, queryOne, isDatabaseAvailable } from '../db/connection.js';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        name: string;
        isManager: boolean;
      };
    }
  }
}

// Validate session token and attach user to request
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    // Handle offline tokens when database isn't available
    if (token.startsWith('offline-')) {
      // Accept offline tokens - extract user ID from token
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
    }>(`
      SELECT s.user_id, s.is_active, s.expires_at, u.name, u.is_manager
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

    // Attach user to request
    req.user = {
      id: session.user_id,
      name: session.name,
      isManager: session.is_manager
    };

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

    // Handle offline tokens
    if (token.startsWith('offline-')) {
      const userId = token.replace('offline-', '');
      req.user = {
        id: userId,
        name: 'Offline User',
        isManager: false
      };
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
    }>(`
      SELECT s.user_id, s.is_active, u.name, u.is_manager
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = $1 AND s.is_active = true
    `, [token]);

    if (session) {
      req.user = {
        id: session.user_id,
        name: session.name,
        isManager: session.is_manager
      };
    }

    next();
  } catch (error) {
    // Don't fail on optional auth errors
    next();
  }
}
