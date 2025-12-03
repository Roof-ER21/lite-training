import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/connection.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// GET /api/progress - Get user's full progress
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

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
    `, [userId]);

    // Get exam attempts
    const examAttempts = await query<{
      id: string;
      attempt_number: number;
      completed_at: Date;
      mcq_correct: number;
      fib_correct: number;
      sa_points: number;
      total_score: number;
      passed: boolean;
    }>(`
      SELECT id, attempt_number, completed_at, mcq_correct, fib_correct, sa_points, total_score, passed
      FROM exam_attempts WHERE user_id = $1
      ORDER BY attempt_number ASC
    `, [userId]);

    // Get certification status
    const certification = await queryOne<{
      certified_at: Date;
      score: number;
    }>(`
      SELECT certified_at, score FROM certifications WHERE user_id = $1
    `, [userId]);

    // Get gamification data
    const gamification = await queryOne<{
      total_xp: number;
      current_streak: number;
      longest_streak: number;
      unlocked_difficulties: string[];
    }>(`
      SELECT total_xp, current_streak, longest_streak, unlocked_difficulties
      FROM user_gamification WHERE user_id = $1
    `, [userId]);

    // Get commitment status
    const user = await queryOne<{
      commitment_signed: boolean;
      commitment_date: Date | null;
    }>(`
      SELECT commitment_signed, commitment_date FROM users WHERE id = $1
    `, [userId]);

    res.json({
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
        completedAt: e.completed_at,
        mcqScore: e.mcq_correct,
        fibScore: e.fib_correct,
        saScore: e.sa_points,
        totalScore: e.total_score,
        passed: e.passed
      })),
      isCertified: !!certification,
      certificationDate: certification?.certified_at,
      certificationScore: certification?.score,
      commitmentSigned: user?.commitment_signed || false,
      commitmentDate: user?.commitment_date,
      gamification: gamification ? {
        totalXP: gamification.total_xp,
        currentStreak: gamification.current_streak,
        longestStreak: gamification.longest_streak,
        unlockedDifficulties: gamification.unlocked_difficulties || []
      } : null
    });
  } catch (error) {
    console.error('Get progress error:', error);
    res.status(500).json({ error: 'Failed to get progress' });
  }
});

// POST /api/progress/module - Update module progress
router.post('/module', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { moduleName, action, timeSpent } = req.body;

    if (!moduleName || !action) {
      return res.status(400).json({ error: 'moduleName and action required' });
    }

    // Upsert module progress
    if (action === 'start' || action === 'unlock') {
      await query(`
        INSERT INTO module_progress (user_id, module_name, status, started_at, last_accessed)
        VALUES ($1, $2, $3, NOW(), NOW())
        ON CONFLICT (user_id, module_name)
        DO UPDATE SET
          status = CASE WHEN module_progress.status = 'locked' THEN $3 ELSE module_progress.status END,
          started_at = COALESCE(module_progress.started_at, NOW()),
          last_accessed = NOW()
      `, [userId, moduleName, action === 'start' ? 'in_progress' : 'unlocked']);
    } else if (action === 'complete') {
      await query(`
        INSERT INTO module_progress (user_id, module_name, status, completed_at, last_accessed)
        VALUES ($1, $2, 'completed', NOW(), NOW())
        ON CONFLICT (user_id, module_name)
        DO UPDATE SET
          status = 'completed',
          completed_at = COALESCE(module_progress.completed_at, NOW()),
          last_accessed = NOW()
      `, [userId, moduleName]);
    } else if (action === 'update' && typeof timeSpent === 'number') {
      await query(`
        UPDATE module_progress
        SET time_spent_seconds = time_spent_seconds + $3, last_accessed = NOW()
        WHERE user_id = $1 AND module_name = $2
      `, [userId, moduleName, timeSpent]);
    }

    // Get updated unlocked modules list
    const unlockedModules = await query<{ module_name: string }>(`
      SELECT module_name FROM module_progress
      WHERE user_id = $1 AND status IN ('unlocked', 'in_progress', 'completed')
    `, [userId]);

    res.json({
      success: true,
      unlockedModules: unlockedModules.map(m => m.module_name)
    });
  } catch (error) {
    console.error('Update module error:', error);
    res.status(500).json({ error: 'Failed to update module progress' });
  }
});

// POST /api/progress/heartbeat - Track time on module
router.post('/heartbeat', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { moduleName, timeSpent } = req.body;

    if (!moduleName || typeof timeSpent !== 'number') {
      return res.status(400).json({ error: 'moduleName and timeSpent required' });
    }

    await query(`
      UPDATE module_progress
      SET time_spent_seconds = time_spent_seconds + $3, last_accessed = NOW()
      WHERE user_id = $1 AND module_name = $2
    `, [userId, moduleName, timeSpent]);

    res.json({ success: true });
  } catch (error) {
    console.error('Heartbeat error:', error);
    res.status(500).json({ error: 'Failed to record heartbeat' });
  }
});

// POST /api/progress/commitment - Sign commitment
router.post('/commitment', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    await query(`
      UPDATE users SET commitment_signed = true, commitment_date = NOW()
      WHERE id = $1
    `, [userId]);

    // Unlock general-knowledge module after commitment
    await query(`
      INSERT INTO module_progress (user_id, module_name, status)
      VALUES ($1, 'general-knowledge', 'unlocked')
      ON CONFLICT (user_id, module_name) DO UPDATE SET status = 'unlocked'
    `, [userId]);

    res.json({ success: true });
  } catch (error) {
    console.error('Commitment error:', error);
    res.status(500).json({ error: 'Failed to sign commitment' });
  }
});

export default router;
