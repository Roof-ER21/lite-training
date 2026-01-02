import { Request, Response, NextFunction } from 'express';
import { query, queryOne } from '../db/connection.js';

// Extend Express Request to include admin info
declare global {
  namespace Express {
    interface Request {
      admin?: {
        id: string;
        username: string;
        displayName: string;
      };
    }
  }
}

// Middleware to require super admin authentication
export async function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }

  const token = authHeader.substring(7);

  try {
    // Look up admin session
    const session = await queryOne<{
      admin_id: string;
      expires_at: Date;
      is_active: boolean;
    }>(`
      SELECT admin_id, expires_at, is_active
      FROM admin_sessions
      WHERE token = $1
    `, [token]);

    if (!session) {
      return res.status(401).json({ error: 'Invalid admin session' });
    }

    if (!session.is_active) {
      return res.status(401).json({ error: 'Admin session has been revoked' });
    }

    if (new Date(session.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Admin session has expired' });
    }

    // Look up admin info
    const admin = await queryOne<{
      id: string;
      username: string;
      display_name: string;
      is_active: boolean;
    }>(`
      SELECT id, username, display_name, is_active
      FROM super_admins
      WHERE id = $1
    `, [session.admin_id]);

    if (!admin || !admin.is_active) {
      return res.status(401).json({ error: 'Admin account is disabled' });
    }

    // Attach admin info to request
    req.admin = {
      id: admin.id,
      username: admin.username,
      displayName: admin.display_name || admin.username
    };

    next();
  } catch (error) {
    console.error('Super admin auth error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

// Helper to log admin actions for audit trail
export async function logAdminAction(
  adminId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  oldValue: any = null,
  newValue: any = null
): Promise<void> {
  try {
    await query(`
      INSERT INTO admin_audit_log (admin_id, action, entity_type, entity_id, old_value, new_value)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      adminId,
      action,
      entityType,
      entityId,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null
    ]);
  } catch (error) {
    console.error('Failed to log admin action:', error);
    // Don't throw - logging failure shouldn't break the operation
  }
}
