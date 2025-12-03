import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/connection.js';
import { requireAuth } from '../middleware/auth.js';
import crypto from 'crypto';

const router = Router();

// Manager code from environment (defaults to roofer2024)
const MANAGER_CODE = process.env.MANAGER_CODE || 'roofer2024';

// Generate session token
function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// POST /api/auth/login - Login or register user
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { name, managerCode } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: 'Name is required (minimum 2 characters)' });
    }

    const trimmedName = name.trim();
    const isManager = managerCode === MANAGER_CODE;

    // Check if user exists
    let user = await queryOne<{ id: string; name: string; is_manager: boolean }>(`
      SELECT id, name, is_manager FROM users WHERE LOWER(name) = LOWER($1)
    `, [trimmedName]);

    if (user) {
      // Existing user - update last login and possibly upgrade to manager
      if (isManager && !user.is_manager) {
        await query('UPDATE users SET is_manager = true, last_login = NOW() WHERE id = $1', [user.id]);
        user.is_manager = true;
      } else {
        await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
      }
    } else {
      // New user - create account
      const newUser = await queryOne<{ id: string; name: string; is_manager: boolean }>(`
        INSERT INTO users (name, is_manager, last_login)
        VALUES ($1, $2, NOW())
        RETURNING id, name, is_manager
      `, [trimmedName, isManager]);

      if (!newUser) {
        return res.status(500).json({ error: 'Failed to create user' });
      }

      user = newUser;

      // Initialize gamification record
      await query(`
        INSERT INTO user_gamification (user_id, total_xp, current_streak)
        VALUES ($1, 0, 0)
        ON CONFLICT (user_id) DO NOTHING
      `, [user.id]);

      // Initialize default module progress (welcome and commitment unlocked)
      const defaultModules = ['welcome', 'commitment'];
      for (const moduleName of defaultModules) {
        await query(`
          INSERT INTO module_progress (user_id, module_name, status)
          VALUES ($1, $2, 'unlocked')
          ON CONFLICT (user_id, module_name) DO NOTHING
        `, [user.id, moduleName]);
      }
    }

    // Create session token
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await query(`
      INSERT INTO sessions (user_id, token, expires_at, is_active)
      VALUES ($1, $2, $3, true)
    `, [user.id, token, expiresAt]);

    // Log login
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    await query(`
      INSERT INTO login_history (user_id, ip_address, user_agent)
      VALUES ($1, $2, $3)
    `, [user.id, ip, userAgent]);

    res.json({
      userId: user.id,
      name: user.name,
      isManager: user.is_manager,
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/logout - Logout user
router.post('/logout', requireAuth, async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (token) {
      await query('UPDATE sessions SET is_active = false WHERE token = $1', [token]);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// GET /api/auth/me - Get current user info
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await queryOne<{
      id: string;
      name: string;
      is_manager: boolean;
      registration_date: Date;
      commitment_signed: boolean;
      commitment_date: Date | null;
    }>(`
      SELECT id, name, is_manager, registration_date, commitment_signed, commitment_date
      FROM users WHERE id = $1
    `, [req.user!.id]);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get progress summary
    const moduleCount = await queryOne<{ count: string }>(`
      SELECT COUNT(*) as count FROM module_progress
      WHERE user_id = $1 AND status = 'completed'
    `, [req.user!.id]);

    const certification = await queryOne<{ certified_at: Date; score: number }>(`
      SELECT certified_at, score FROM certifications WHERE user_id = $1
    `, [req.user!.id]);

    const gamification = await queryOne<{
      total_xp: number;
      current_streak: number;
    }>(`
      SELECT total_xp, current_streak FROM user_gamification WHERE user_id = $1
    `, [req.user!.id]);

    res.json({
      id: user.id,
      name: user.name,
      isManager: user.is_manager,
      registrationDate: user.registration_date,
      commitmentSigned: user.commitment_signed,
      commitmentDate: user.commitment_date,
      modulesCompleted: parseInt(moduleCount?.count || '0'),
      isCertified: !!certification,
      certificationDate: certification?.certified_at,
      certificationScore: certification?.score,
      totalXP: gamification?.total_xp || 0,
      currentStreak: gamification?.current_streak || 0
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// POST /api/auth/validate - Check if token is valid (for frontend session check)
router.post('/validate', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.json({ valid: false });
    }

    const session = await queryOne<{
      user_id: string;
      is_active: boolean;
      expires_at: Date;
      name: string;
      is_manager: boolean;
    }>(`
      SELECT s.user_id, s.is_active, s.expires_at, u.name, u.is_manager
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = $1
    `, [token]);

    if (!session || !session.is_active) {
      return res.json({ valid: false });
    }

    if (session.expires_at && new Date(session.expires_at) < new Date()) {
      await query('UPDATE sessions SET is_active = false WHERE token = $1', [token]);
      return res.json({ valid: false });
    }

    res.json({
      valid: true,
      userId: session.user_id,
      name: session.name,
      isManager: session.is_manager
    });
  } catch (error) {
    console.error('Validate error:', error);
    res.json({ valid: false });
  }
});

export default router;
