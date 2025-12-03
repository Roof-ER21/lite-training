import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/connection.js';
import { requireAuth, requireManager } from '../middleware/auth.js';

const router = Router();

// All admin routes require authentication and manager role
router.use(requireAuth);
router.use(requireManager);

// GET /api/admin/users - Get all users with summary stats
router.get('/users', async (req: Request, res: Response) => {
  try {
    const users = await query<{
      id: string;
      name: string;
      is_manager: boolean;
      registration_date: Date;
      last_login: Date | null;
      commitment_signed: boolean;
      modules_completed: string;
      exam_attempts: string;
      is_certified: boolean;
      total_xp: number;
    }>(`
      SELECT
        u.id,
        u.name,
        u.is_manager,
        u.registration_date,
        u.last_login,
        u.commitment_signed,
        COALESCE(mp.modules_completed, '0') as modules_completed,
        COALESCE(ea.exam_attempts, '0') as exam_attempts,
        CASE WHEN c.id IS NOT NULL THEN true ELSE false END as is_certified,
        COALESCE(g.total_xp, 0) as total_xp
      FROM users u
      LEFT JOIN (
        SELECT user_id, COUNT(*) as modules_completed
        FROM module_progress WHERE status = 'completed'
        GROUP BY user_id
      ) mp ON u.id = mp.user_id
      LEFT JOIN (
        SELECT user_id, COUNT(*) as exam_attempts
        FROM exam_attempts
        GROUP BY user_id
      ) ea ON u.id = ea.user_id
      LEFT JOIN certifications c ON u.id = c.user_id
      LEFT JOIN user_gamification g ON u.id = g.user_id
      ORDER BY u.registration_date DESC
    `);

    res.json({
      users: users.map(u => ({
        id: u.id,
        name: u.name,
        isManager: u.is_manager,
        registrationDate: u.registration_date,
        lastLogin: u.last_login,
        commitmentSigned: u.commitment_signed,
        modulesCompleted: parseInt(u.modules_completed),
        examAttempts: parseInt(u.exam_attempts),
        isCertified: u.is_certified,
        totalXP: u.total_xp
      })),
      totalUsers: users.length
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// GET /api/admin/users/:id - Get detailed user info
router.get('/users/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Get user basic info
    const user = await queryOne<{
      id: string;
      name: string;
      is_manager: boolean;
      registration_date: Date;
      last_login: Date | null;
      commitment_signed: boolean;
      commitment_date: Date | null;
    }>(`
      SELECT id, name, is_manager, registration_date, last_login, commitment_signed, commitment_date
      FROM users WHERE id = $1
    `, [id]);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get module progress
    const modules = await query<{
      module_name: string;
      status: string;
      started_at: Date | null;
      completed_at: Date | null;
      time_spent_seconds: number;
    }>(`
      SELECT module_name, status, started_at, completed_at, time_spent_seconds
      FROM module_progress WHERE user_id = $1
      ORDER BY started_at ASC
    `, [id]);

    // Get exam attempts
    const examAttempts = await query<{
      id: string;
      attempt_number: number;
      started_at: Date;
      completed_at: Date | null;
      mcq_correct: number;
      fib_correct: number;
      sa_points: number;
      total_score: number;
      passed: boolean;
      time_taken_seconds: number;
    }>(`
      SELECT id, attempt_number, started_at, completed_at, mcq_correct, fib_correct,
             sa_points, total_score, passed, time_taken_seconds
      FROM exam_attempts WHERE user_id = $1
      ORDER BY attempt_number ASC
    `, [id]);

    // Get roleplay sessions
    const roleplaySessions = await query<{
      id: string;
      started_at: Date;
      completed_at: Date | null;
      personality: string;
      difficulty: string;
      final_score: number | null;
      xp_earned: number | null;
      door_slammed: boolean;
    }>(`
      SELECT id, started_at, completed_at, personality, difficulty,
             final_score, xp_earned, door_slammed
      FROM roleplay_sessions WHERE user_id = $1
      ORDER BY started_at DESC
    `, [id]);

    // Get certification
    const certification = await queryOne<{
      certified_at: Date;
      score: number;
    }>(`
      SELECT certified_at, score FROM certifications WHERE user_id = $1
    `, [id]);

    // Get gamification
    const gamification = await queryOne<{
      total_xp: number;
      current_streak: number;
      longest_streak: number;
      unlocked_difficulties: string[];
    }>(`
      SELECT total_xp, current_streak, longest_streak, unlocked_difficulties
      FROM user_gamification WHERE user_id = $1
    `, [id]);

    // Get login history
    const loginHistory = await query<{
      login_at: Date;
      ip_address: string;
      user_agent: string;
    }>(`
      SELECT login_at, ip_address, user_agent
      FROM login_history WHERE user_id = $1
      ORDER BY login_at DESC
      LIMIT 20
    `, [id]);

    res.json({
      user: {
        id: user.id,
        name: user.name,
        isManager: user.is_manager,
        registrationDate: user.registration_date,
        lastLogin: user.last_login,
        commitmentSigned: user.commitment_signed,
        commitmentDate: user.commitment_date
      },
      modules: modules.map(m => ({
        name: m.module_name,
        status: m.status,
        startedAt: m.started_at,
        completedAt: m.completed_at,
        timeSpentSeconds: m.time_spent_seconds
      })),
      examAttempts: examAttempts.map(e => ({
        id: e.id,
        attemptNumber: e.attempt_number,
        startedAt: e.started_at,
        completedAt: e.completed_at,
        mcqScore: e.mcq_correct,
        fibScore: e.fib_correct,
        saScore: e.sa_points,
        totalScore: e.total_score,
        passed: e.passed,
        timeTaken: e.time_taken_seconds
      })),
      roleplaySessions: roleplaySessions.map(r => ({
        id: r.id,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        personality: r.personality,
        difficulty: r.difficulty,
        finalScore: r.final_score,
        xpEarned: r.xp_earned,
        doorSlammed: r.door_slammed
      })),
      certification: certification ? {
        certifiedAt: certification.certified_at,
        score: certification.score
      } : null,
      gamification: gamification ? {
        totalXP: gamification.total_xp,
        currentStreak: gamification.current_streak,
        longestStreak: gamification.longest_streak,
        unlockedDifficulties: gamification.unlocked_difficulties || []
      } : null,
      loginHistory: loginHistory.map(l => ({
        loginAt: l.login_at,
        ipAddress: l.ip_address,
        userAgent: l.user_agent
      }))
    });
  } catch (error) {
    console.error('Get user detail error:', error);
    res.status(500).json({ error: 'Failed to get user details' });
  }
});

// GET /api/admin/analytics - Get platform-wide analytics
router.get('/analytics', async (req: Request, res: Response) => {
  try {
    // Total users
    const totalUsers = await queryOne<{ count: string }>(`
      SELECT COUNT(*) as count FROM users
    `);

    // Users registered this week
    const newUsersThisWeek = await queryOne<{ count: string }>(`
      SELECT COUNT(*) as count FROM users
      WHERE registration_date > NOW() - INTERVAL '7 days'
    `);

    // Active users (logged in within 7 days)
    const activeUsers = await queryOne<{ count: string }>(`
      SELECT COUNT(*) as count FROM users
      WHERE last_login > NOW() - INTERVAL '7 days'
    `);

    // Certified users
    const certifiedUsers = await queryOne<{ count: string }>(`
      SELECT COUNT(*) as count FROM certifications
    `);

    // Exam stats
    const examStats = await queryOne<{
      total_attempts: string;
      total_passed: string;
      avg_score: string;
    }>(`
      SELECT
        COUNT(*) as total_attempts,
        COUNT(*) FILTER (WHERE passed = true) as total_passed,
        ROUND(AVG(total_score)::numeric, 1) as avg_score
      FROM exam_attempts
      WHERE completed_at IS NOT NULL
    `);

    // Module completion rates
    const moduleStats = await query<{
      module_name: string;
      started: string;
      completed: string;
    }>(`
      SELECT
        module_name,
        COUNT(*) FILTER (WHERE status IN ('in_progress', 'completed')) as started,
        COUNT(*) FILTER (WHERE status = 'completed') as completed
      FROM module_progress
      GROUP BY module_name
      ORDER BY module_name
    `);

    // Roleplay stats
    const roleplayStats = await queryOne<{
      total_sessions: string;
      completed_sessions: string;
      avg_score: string;
      total_xp: string;
    }>(`
      SELECT
        COUNT(*) as total_sessions,
        COUNT(*) FILTER (WHERE completed_at IS NOT NULL) as completed_sessions,
        ROUND(AVG(final_score)::numeric, 1) as avg_score,
        COALESCE(SUM(xp_earned), 0) as total_xp
      FROM roleplay_sessions
    `);

    // Users by commitment status
    const commitmentStats = await queryOne<{
      signed: string;
      unsigned: string;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE commitment_signed = true) as signed,
        COUNT(*) FILTER (WHERE commitment_signed = false) as unsigned
      FROM users
    `);

    // Daily activity (last 30 days)
    const dailyActivity = await query<{
      date: Date;
      logins: string;
      new_users: string;
    }>(`
      SELECT
        DATE(day) as date,
        COALESCE(logins.count, 0) as logins,
        COALESCE(new_users.count, 0) as new_users
      FROM generate_series(
        NOW() - INTERVAL '30 days',
        NOW(),
        '1 day'
      ) AS day
      LEFT JOIN (
        SELECT DATE(login_at) as date, COUNT(*) as count
        FROM login_history
        WHERE login_at > NOW() - INTERVAL '30 days'
        GROUP BY DATE(login_at)
      ) logins ON DATE(day) = logins.date
      LEFT JOIN (
        SELECT DATE(registration_date) as date, COUNT(*) as count
        FROM users
        WHERE registration_date > NOW() - INTERVAL '30 days'
        GROUP BY DATE(registration_date)
      ) new_users ON DATE(day) = new_users.date
      ORDER BY date ASC
    `);

    res.json({
      overview: {
        totalUsers: parseInt(totalUsers?.count || '0'),
        newUsersThisWeek: parseInt(newUsersThisWeek?.count || '0'),
        activeUsers: parseInt(activeUsers?.count || '0'),
        certifiedUsers: parseInt(certifiedUsers?.count || '0')
      },
      exam: {
        totalAttempts: parseInt(examStats?.total_attempts || '0'),
        totalPassed: parseInt(examStats?.total_passed || '0'),
        passRate: examStats?.total_attempts && parseInt(examStats.total_attempts) > 0
          ? Math.round((parseInt(examStats.total_passed || '0') / parseInt(examStats.total_attempts)) * 100)
          : 0,
        averageScore: parseFloat(examStats?.avg_score || '0')
      },
      modules: moduleStats.map(m => ({
        name: m.module_name,
        started: parseInt(m.started),
        completed: parseInt(m.completed),
        completionRate: parseInt(m.started) > 0
          ? Math.round((parseInt(m.completed) / parseInt(m.started)) * 100)
          : 0
      })),
      roleplay: {
        totalSessions: parseInt(roleplayStats?.total_sessions || '0'),
        completedSessions: parseInt(roleplayStats?.completed_sessions || '0'),
        averageScore: parseFloat(roleplayStats?.avg_score || '0'),
        totalXPAwarded: parseInt(roleplayStats?.total_xp || '0')
      },
      commitment: {
        signed: parseInt(commitmentStats?.signed || '0'),
        unsigned: parseInt(commitmentStats?.unsigned || '0')
      },
      dailyActivity: dailyActivity.map(d => ({
        date: d.date,
        logins: parseInt(d.logins as unknown as string || '0'),
        newUsers: parseInt(d.new_users as unknown as string || '0')
      }))
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

// POST /api/admin/users/:id/reset-exam - Reset user's exam attempts
router.post('/users/:id/reset-exam', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Delete all exam attempts and answers for this user
    await query(`
      DELETE FROM exam_answers WHERE attempt_id IN (
        SELECT id FROM exam_attempts WHERE user_id = $1
      )
    `, [id]);

    await query(`
      DELETE FROM exam_attempts WHERE user_id = $1
    `, [id]);

    // Also remove certification if exists
    await query(`
      DELETE FROM certifications WHERE user_id = $1
    `, [id]);

    res.json({ success: true, message: 'Exam attempts reset successfully' });
  } catch (error) {
    console.error('Reset exam error:', error);
    res.status(500).json({ error: 'Failed to reset exam attempts' });
  }
});

// POST /api/admin/users/:id/reset-progress - Reset all user progress
router.post('/users/:id/reset-progress', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Reset module progress
    await query(`
      DELETE FROM module_progress WHERE user_id = $1
    `, [id]);

    // Re-initialize default modules
    const defaultModules = ['welcome', 'commitment'];
    for (const moduleName of defaultModules) {
      await query(`
        INSERT INTO module_progress (user_id, module_name, status)
        VALUES ($1, $2, 'unlocked')
        ON CONFLICT (user_id, module_name) DO NOTHING
      `, [id, moduleName]);
    }

    // Reset commitment
    await query(`
      UPDATE users SET commitment_signed = false, commitment_date = NULL
      WHERE id = $1
    `, [id]);

    // Reset exam attempts
    await query(`
      DELETE FROM exam_answers WHERE attempt_id IN (
        SELECT id FROM exam_attempts WHERE user_id = $1
      )
    `, [id]);
    await query(`DELETE FROM exam_attempts WHERE user_id = $1`, [id]);

    // Reset certification
    await query(`DELETE FROM certifications WHERE user_id = $1`, [id]);

    // Reset roleplay
    await query(`
      DELETE FROM roleplay_scores WHERE session_id IN (
        SELECT id FROM roleplay_sessions WHERE user_id = $1
      )
    `, [id]);
    await query(`DELETE FROM roleplay_sessions WHERE user_id = $1`, [id]);

    // Reset gamification
    await query(`
      UPDATE user_gamification
      SET total_xp = 0, current_streak = 0, unlocked_difficulties = ARRAY['easy']
      WHERE user_id = $1
    `, [id]);

    res.json({ success: true, message: 'All progress reset successfully' });
  } catch (error) {
    console.error('Reset progress error:', error);
    res.status(500).json({ error: 'Failed to reset progress' });
  }
});

// DELETE /api/admin/users/:id - Delete a user entirely
router.delete('/users/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const requesterId = req.user!.id;

    // Prevent self-deletion
    if (id === requesterId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Delete user (cascades will handle related records)
    const result = await query(`
      DELETE FROM users WHERE id = $1 RETURNING id
    `, [id]);

    if (result.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
