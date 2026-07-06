import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { query, queryOne } from '../db/connection.js';
import { requireSuperAdmin, logAdminAction } from '../middleware/superadmin.js';
import { rateLimit } from '../middleware/rate-limit.js';

const router = Router();

const BCRYPT_ROUNDS = 12;
const SESSION_DURATION_HOURS = 8;
const DEFAULT_ADMIN_USERNAME = 'monmon';

// Superadmin login is the highest-value target — keep guesses slow
const adminLoginLimiter = rateLimit({ windowMs: 60_000, max: 5, name: 'admin-login' });

// Seed initial admin if none exists
export async function seedInitialAdmin(): Promise<void> {
  try {
    const existingAdmin = await queryOne(`SELECT id FROM super_admins LIMIT 1`);

    if (!existingAdmin) {
      // No hardcoded default password — seeding requires ADMIN_PASSWORD to be
      // set explicitly, otherwise a fresh deploy ships a guessable admin.
      if (!process.env.ADMIN_PASSWORD) {
        console.error('No super admin exists and ADMIN_PASSWORD is not set — skipping seed. Set ADMIN_PASSWORD and restart to create the initial admin.');
        return;
      }
      console.log('No super admin found, creating initial admin...');
      const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, BCRYPT_ROUNDS);

      await query(`
        INSERT INTO super_admins (username, password_hash, display_name)
        VALUES ($1, $2, $3)
      `, [DEFAULT_ADMIN_USERNAME, passwordHash, 'Super Admin']);

      console.log(`Initial super admin created: ${DEFAULT_ADMIN_USERNAME}`);
    }
  } catch (error) {
    console.error('Failed to seed initial admin:', error);
  }
}

// POST /api/admin-auth/login - Super admin login
router.post('/login', adminLoginLimiter, async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Look up admin
    const admin = await queryOne<{
      id: string;
      username: string;
      password_hash: string;
      display_name: string;
      is_active: boolean;
    }>(`
      SELECT id, username, password_hash, display_name, is_active
      FROM super_admins
      WHERE username = $1
    `, [username.toLowerCase()]);

    if (!admin) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!admin.is_active) {
      return res.status(401).json({ error: 'Account is disabled' });
    }

    // Verify password
    const passwordValid = await bcrypt.compare(password, admin.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate session token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000);

    // Create session
    await query(`
      INSERT INTO admin_sessions (admin_id, token, expires_at)
      VALUES ($1, $2, $3)
    `, [admin.id, token, expiresAt]);

    // Update last login
    await query(`
      UPDATE super_admins SET last_login = NOW() WHERE id = $1
    `, [admin.id]);

    // Log the login
    await logAdminAction(admin.id, 'login', 'session', null);

    res.json({
      token,
      expiresAt,
      admin: {
        id: admin.id,
        username: admin.username,
        displayName: admin.display_name || admin.username
      }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/admin-auth/logout - Super admin logout
router.post('/logout', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.substring(7);

    if (token) {
      await query(`
        UPDATE admin_sessions SET is_active = FALSE WHERE token = $1
      `, [token]);

      await logAdminAction(req.admin!.id, 'logout', 'session', null);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Admin logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// GET /api/admin-auth/me - Get current admin info
router.get('/me', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const admin = await queryOne<{
      id: string;
      username: string;
      display_name: string;
      created_at: Date;
      last_login: Date;
    }>(`
      SELECT id, username, display_name, created_at, last_login
      FROM super_admins
      WHERE id = $1
    `, [req.admin!.id]);

    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    res.json({
      id: admin.id,
      username: admin.username,
      displayName: admin.display_name || admin.username,
      createdAt: admin.created_at,
      lastLogin: admin.last_login
    });
  } catch (error) {
    console.error('Get admin error:', error);
    res.status(500).json({ error: 'Failed to get admin info' });
  }
});

// POST /api/admin-auth/change-password - Change admin password
router.post('/change-password', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Verify current password
    const admin = await queryOne<{ password_hash: string }>(`
      SELECT password_hash FROM super_admins WHERE id = $1
    `, [req.admin!.id]);

    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    const passwordValid = await bcrypt.compare(currentPassword, admin.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash and update new password
    const newPasswordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await query(`
      UPDATE super_admins SET password_hash = $1 WHERE id = $2
    `, [newPasswordHash, req.admin!.id]);

    // Invalidate all other sessions
    const authHeader = req.headers.authorization;
    const currentToken = authHeader?.substring(7);

    await query(`
      UPDATE admin_sessions SET is_active = FALSE
      WHERE admin_id = $1 AND token != $2
    `, [req.admin!.id, currentToken]);

    await logAdminAction(req.admin!.id, 'change_password', 'admin', req.admin!.id);

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// GET /api/admin-auth/audit-log - Get audit log
router.get('/audit-log', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const entityType = req.query.entityType as string;

    let whereClause = '';
    const params: any[] = [limit, offset];

    if (entityType) {
      whereClause = 'WHERE entity_type = $3';
      params.push(entityType);
    }

    const logs = await query<{
      id: string;
      admin_id: string;
      action: string;
      entity_type: string;
      entity_id: string;
      old_value: any;
      new_value: any;
      created_at: Date;
    }>(`
      SELECT al.*, sa.username as admin_username
      FROM admin_audit_log al
      LEFT JOIN super_admins sa ON al.admin_id = sa.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT $1 OFFSET $2
    `, params);

    res.json({
      logs: logs.map(log => ({
        id: log.id,
        adminId: log.admin_id,
        action: log.action,
        entityType: log.entity_type,
        entityId: log.entity_id,
        oldValue: log.old_value,
        newValue: log.new_value,
        createdAt: log.created_at
      })),
      limit,
      offset
    });
  } catch (error) {
    console.error('Get audit log error:', error);
    res.status(500).json({ error: 'Failed to get audit log' });
  }
});

export default router;
