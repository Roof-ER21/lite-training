import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/connection.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// POST /api/roleplay/start - Start a new roleplay session
router.post('/start', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { personality, difficulty, inputMode } = req.body;

    if (!personality || !difficulty || !inputMode) {
      return res.status(400).json({ error: 'personality, difficulty, and inputMode required' });
    }

    const session = await queryOne<{ id: string }>(`
      INSERT INTO roleplay_sessions (user_id, personality, difficulty, input_mode, started_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING id
    `, [userId, personality, difficulty, inputMode]);

    res.json({
      sessionId: session?.id,
      success: true
    });
  } catch (error) {
    console.error('Start roleplay error:', error);
    res.status(500).json({ error: 'Failed to start roleplay session' });
  }
});

// POST /api/roleplay/score - Record a score event during roleplay
router.post('/score', async (req: Request, res: Response) => {
  try {
    const { sessionId, category, points, reason } = req.body;

    if (!sessionId || !category || points === undefined) {
      return res.status(400).json({ error: 'sessionId, category, and points required' });
    }

    await query(`
      INSERT INTO roleplay_scores (session_id, category, points, reason)
      VALUES ($1, $2, $3, $4)
    `, [sessionId, category, points, reason || null]);

    res.json({ success: true });
  } catch (error) {
    console.error('Record score error:', error);
    res.status(500).json({ error: 'Failed to record score' });
  }
});

// POST /api/roleplay/end - End a roleplay session
router.post('/end', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { sessionId, finalScore, xpEarned, doorSlammed, conversationLog } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }

    // Update session with final results
    await query(`
      UPDATE roleplay_sessions SET
        completed_at = NOW(),
        final_score = $2,
        xp_earned = $3,
        door_slammed = $4,
        conversation_log = $5
      WHERE id = $1 AND user_id = $6
    `, [sessionId, finalScore || 0, xpEarned || 0, doorSlammed || false, conversationLog || null, userId]);

    // Update user gamification if XP was earned
    if (xpEarned && xpEarned > 0) {
      await query(`
        UPDATE user_gamification
        SET total_xp = total_xp + $2,
            last_activity_date = NOW()
        WHERE user_id = $1
      `, [userId, xpEarned]);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('End roleplay error:', error);
    res.status(500).json({ error: 'Failed to end roleplay session' });
  }
});

// GET /api/roleplay/history - Get user's roleplay history
router.get('/history', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const sessions = await query<{
      id: string;
      started_at: Date;
      completed_at: Date | null;
      personality: string;
      difficulty: string;
      input_mode: string;
      final_score: number | null;
      xp_earned: number | null;
      door_slammed: boolean;
    }>(`
      SELECT id, started_at, completed_at, personality, difficulty, input_mode,
             final_score, xp_earned, door_slammed
      FROM roleplay_sessions
      WHERE user_id = $1
      ORDER BY started_at DESC
      LIMIT 50
    `, [userId]);

    res.json({
      sessions: sessions.map(s => ({
        id: s.id,
        startedAt: s.started_at,
        completedAt: s.completed_at,
        personality: s.personality,
        difficulty: s.difficulty,
        inputMode: s.input_mode,
        finalScore: s.final_score,
        xpEarned: s.xp_earned,
        doorSlammed: s.door_slammed
      }))
    });
  } catch (error) {
    console.error('Get roleplay history error:', error);
    res.status(500).json({ error: 'Failed to get roleplay history' });
  }
});

// GET /api/roleplay/session/:sessionId - Get detailed session info
router.get('/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { sessionId } = req.params;

    const session = await queryOne<{
      id: string;
      user_id: string;
      started_at: Date;
      completed_at: Date | null;
      personality: string;
      difficulty: string;
      input_mode: string;
      final_score: number | null;
      xp_earned: number | null;
      door_slammed: boolean;
      conversation_log: string | null;
    }>(`
      SELECT * FROM roleplay_sessions WHERE id = $1
    `, [sessionId]);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Check access - user can only see their own sessions unless manager
    if (session.user_id !== userId && !req.user!.isManager) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get score breakdown
    const scores = await query<{
      category: string;
      points: number;
      reason: string | null;
      recorded_at: Date;
    }>(`
      SELECT category, points, reason, recorded_at
      FROM roleplay_scores
      WHERE session_id = $1
      ORDER BY recorded_at ASC
    `, [sessionId]);

    res.json({
      session: {
        id: session.id,
        startedAt: session.started_at,
        completedAt: session.completed_at,
        personality: session.personality,
        difficulty: session.difficulty,
        inputMode: session.input_mode,
        finalScore: session.final_score,
        xpEarned: session.xp_earned,
        doorSlammed: session.door_slammed,
        conversationLog: session.conversation_log
      },
      scores: scores.map(s => ({
        category: s.category,
        points: s.points,
        reason: s.reason,
        recordedAt: s.recorded_at
      }))
    });
  } catch (error) {
    console.error('Get session detail error:', error);
    res.status(500).json({ error: 'Failed to get session details' });
  }
});

export default router;
