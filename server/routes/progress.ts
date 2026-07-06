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

// Module order - must match MODULE_ORDER in frontend index.tsx
const MODULE_ORDER = [
  'welcome', 'commitment', 'general-knowledge', 'shingle-types-materials',
  'initial-pitch', 'handling-initial-pitch-objections', 'damage-identification',
  'inspection-process', 'post-inspection-pitch', 'post-inspection-objections',
  'filing-claim-closing', 'sales-cycle-job-flow', 'role-play', 'final-exam'
];

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
          status = CASE WHEN module_progress.status IN ('locked') THEN $3 ELSE module_progress.status END,
          started_at = COALESCE(module_progress.started_at, NOW()),
          last_accessed = NOW()
      `, [userId, moduleName, action === 'start' ? 'in_progress' : 'unlocked']);
    } else if (action === 'complete') {
      // Mark current module as completed
      await query(`
        INSERT INTO module_progress (user_id, module_name, status, completed_at, last_accessed)
        VALUES ($1, $2, 'completed', NOW(), NOW())
        ON CONFLICT (user_id, module_name)
        DO UPDATE SET
          status = 'completed',
          completed_at = COALESCE(module_progress.completed_at, NOW()),
          last_accessed = NOW()
      `, [userId, moduleName]);

      // Auto-unlock the next module in sequence (server-side guarantee)
      const currentIndex = MODULE_ORDER.indexOf(moduleName);
      if (currentIndex >= 0 && currentIndex < MODULE_ORDER.length - 1) {
        const modulesToUnlock = [MODULE_ORDER[currentIndex + 1]];

        // Completing sales-cycle-job-flow (module 12) unlocks both role-play AND final-exam
        if (moduleName === 'sales-cycle-job-flow') {
          modulesToUnlock.push('final-exam');
        }

        for (const nextModule of modulesToUnlock) {
          await query(`
            INSERT INTO module_progress (user_id, module_name, status, last_accessed)
            VALUES ($1, $2, 'unlocked', NOW())
            ON CONFLICT (user_id, module_name)
            DO UPDATE SET
              status = CASE WHEN module_progress.status = 'locked' THEN 'unlocked' ELSE module_progress.status END,
              last_accessed = NOW()
          `, [userId, nextModule]);
          console.log(`Auto-unlocked module '${nextModule}' for user ${userId} after completing '${moduleName}'`);
        }
      }
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

    // Clamp each heartbeat to the client's interval size. Defense in depth so a
    // stuck/backgrounded tab or a tampered client can't inflate training time
    // (this is what produced bogus "60h" totals). The client also suppresses
    // heartbeats while idle/hidden — this is the server-side backstop.
    const HEARTBEAT_MAX_SECONDS = 60;
    const delta = Math.min(Math.max(0, timeSpent), HEARTBEAT_MAX_SECONDS);

    await query(`
      UPDATE module_progress
      SET time_spent_seconds = time_spent_seconds + $3, last_accessed = NOW()
      WHERE user_id = $1 AND module_name = $2
    `, [userId, moduleName, delta]);

    res.json({ success: true });
  } catch (error) {
    console.error('Heartbeat error:', error);
    res.status(500).json({ error: 'Failed to record heartbeat' });
  }
});

// POST /api/progress/activity - Track activity completions (quiz, game, practice, challenge, roleplay)
router.post('/activity', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { moduleName, activityType, completed } = req.body;

    if (!moduleName || !activityType) {
      return res.status(400).json({ error: 'moduleName and activityType required' });
    }

    // Valid activity types
    const validTypes = ['quiz', 'game', 'practice', 'challenge', 'roleplay'];
    if (!validTypes.includes(activityType)) {
      return res.status(400).json({ error: 'Invalid activityType. Must be one of: quiz, game, practice, challenge, roleplay' });
    }

    // Store activity completion in module_progress metadata
    // We'll use a JSONB column if available, otherwise store as a simple flag
    await query(`
      INSERT INTO module_progress (user_id, module_name, status, last_accessed)
      VALUES ($1, $2, 'in_progress', NOW())
      ON CONFLICT (user_id, module_name)
      DO UPDATE SET last_accessed = NOW()
    `, [userId, moduleName]);

    // Log activity for admin tracking
    await query(`
      INSERT INTO activity_log (user_id, module_name, activity_type, completed_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT DO NOTHING
    `, [userId, moduleName, activityType]).catch(() => {
      // Table might not exist, that's OK - silently continue
    });

    res.json({ success: true, activityType, moduleName, completed });
  } catch (error) {
    console.error('Activity tracking error:', error);
    res.status(500).json({ error: 'Failed to track activity' });
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

// ============================================
// BADGE SYSTEM
// ============================================

// Badge definitions
const BADGE_DEFINITIONS: Record<string, { name: string; description: string; icon: string }> = {
  'first-steps': { name: 'First Steps', description: 'Complete your first module', icon: '👣' },
  'damage-detective': { name: 'Damage Detective', description: 'Score 100% on Module 10 hotspot quiz', icon: '🔍' },
  'agnes-whisperer': { name: 'Agnes Whisperer', description: 'Pass 10 Agnes roleplay scenarios', icon: '🎭' },
  'speed-demon': { name: 'Speed Demon', description: 'Complete any module in under 15 minutes', icon: '⚡' },
  'perfect-score': { name: 'Perfect Score', description: '100% on final exam', icon: '💯' },
  'streak-master': { name: 'Streak Master', description: '7-day learning streak', icon: '🔥' },
  'night-owl': { name: 'Night Owl', description: 'Complete training after 9 PM', icon: '🦉' },
  'early-bird': { name: 'Early Bird', description: 'Complete training before 7 AM', icon: '🐦' },
  'video-scholar': { name: 'Video Scholar', description: 'Watch all 7 training videos', icon: '📺' },
  'certified-pro': { name: 'Certified Pro', description: 'Complete entire certification', icon: '🏆' },
  'streak-3': { name: 'Getting Started', description: '3-day learning streak', icon: '🌱' },
  'streak-14': { name: 'Dedicated Learner', description: '14-day learning streak', icon: '💪' },
  'streak-30': { name: 'Training Champion', description: '30-day learning streak', icon: '👑' }
};

// GET /api/progress/badges - Get user's badges
router.get('/badges', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const userBadges = await query<{ badge_id: string; earned_at: Date }>(`
      SELECT badge_id, earned_at FROM user_badges WHERE user_id = $1
    `, [userId]);

    const badges = userBadges.map(b => ({
      id: b.badge_id,
      ...BADGE_DEFINITIONS[b.badge_id],
      earnedAt: b.earned_at
    }));

    res.json({
      earned: badges,
      available: Object.entries(BADGE_DEFINITIONS).map(([id, def]) => ({
        id,
        ...def,
        earned: badges.some(b => b.id === id)
      }))
    });
  } catch (error) {
    console.error('Get badges error:', error);
    res.status(500).json({ error: 'Failed to get badges' });
  }
});

// POST /api/progress/badges/award - Award a badge
router.post('/badges/award', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { badgeId } = req.body;

    if (!badgeId || !BADGE_DEFINITIONS[badgeId]) {
      return res.status(400).json({ error: 'Invalid badge ID' });
    }

    // Check if already earned
    const existing = await queryOne(`
      SELECT id FROM user_badges WHERE user_id = $1 AND badge_id = $2
    `, [userId, badgeId]);

    if (existing) {
      return res.json({ awarded: false, message: 'Badge already earned' });
    }

    // Award the badge
    await query(`
      INSERT INTO user_badges (user_id, badge_id) VALUES ($1, $2)
    `, [userId, badgeId]);

    res.json({
      awarded: true,
      badge: { id: badgeId, ...BADGE_DEFINITIONS[badgeId] }
    });
  } catch (error) {
    console.error('Award badge error:', error);
    res.status(500).json({ error: 'Failed to award badge' });
  }
});

// POST /api/progress/badges/check - Check and award any earned badges
router.post('/badges/check', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const newBadges: string[] = [];

    // Get user's current stats
    const [modules, gamification, exams, roleplays, certs] = await Promise.all([
      query<{ module_name: string; status: string; time_spent_seconds: number; completed_at: Date }>(`
        SELECT module_name, status, time_spent_seconds, completed_at FROM module_progress WHERE user_id = $1
      `, [userId]),
      queryOne<{ current_streak: number; longest_streak: number }>(`
        SELECT current_streak, longest_streak FROM user_gamification WHERE user_id = $1
      `, [userId]),
      query<{ passed: boolean; total_score: number }>(`
        SELECT passed, total_score FROM exam_attempts WHERE user_id = $1
      `, [userId]),
      query<{ final_score: number }>(`
        SELECT final_score FROM roleplay_sessions WHERE user_id = $1 AND final_score >= 70
      `, [userId]),
      queryOne(`SELECT id FROM certifications WHERE user_id = $1`, [userId])
    ]);

    // Get already earned badges
    const earnedBadges = await query<{ badge_id: string }>(`
      SELECT badge_id FROM user_badges WHERE user_id = $1
    `, [userId]);
    const earned = new Set(earnedBadges.map(b => b.badge_id));

    // Check each badge condition
    const completedModules = modules.filter(m => m.status === 'completed');
    const currentHour = new Date().getHours();

    // First Steps - complete first module
    if (!earned.has('first-steps') && completedModules.length >= 1) {
      newBadges.push('first-steps');
    }

    // Speed Demon - any module in under 15 minutes
    if (!earned.has('speed-demon') && modules.some(m => m.status === 'completed' && m.time_spent_seconds < 900)) {
      newBadges.push('speed-demon');
    }

    // Streak badges
    const streak = gamification?.current_streak || gamification?.longest_streak || 0;
    if (!earned.has('streak-3') && streak >= 3) newBadges.push('streak-3');
    if (!earned.has('streak-master') && streak >= 7) newBadges.push('streak-master');
    if (!earned.has('streak-14') && streak >= 14) newBadges.push('streak-14');
    if (!earned.has('streak-30') && streak >= 30) newBadges.push('streak-30');

    // Perfect Score - 100% on exam
    if (!earned.has('perfect-score') && exams.some(e => e.total_score === 100)) {
      newBadges.push('perfect-score');
    }

    // Agnes Whisperer - 10 passed roleplays
    if (!earned.has('agnes-whisperer') && roleplays.length >= 10) {
      newBadges.push('agnes-whisperer');
    }

    // Certified Pro - has certification
    if (!earned.has('certified-pro') && certs) {
      newBadges.push('certified-pro');
    }

    // Night Owl / Early Bird based on current time
    if (!earned.has('night-owl') && currentHour >= 21 && completedModules.length > 0) {
      newBadges.push('night-owl');
    }
    if (!earned.has('early-bird') && currentHour < 7 && completedModules.length > 0) {
      newBadges.push('early-bird');
    }

    // Award new badges
    for (const badgeId of newBadges) {
      await query(`
        INSERT INTO user_badges (user_id, badge_id) VALUES ($1, $2)
        ON CONFLICT (user_id, badge_id) DO NOTHING
      `, [userId, badgeId]);
    }

    res.json({
      newBadges: newBadges.map(id => ({ id, ...BADGE_DEFINITIONS[id] })),
      totalBadges: earned.size + newBadges.length
    });
  } catch (error) {
    console.error('Check badges error:', error);
    res.status(500).json({ error: 'Failed to check badges' });
  }
});

// ============================================
// LEADERBOARD SYSTEM
// ============================================

// GET /api/progress/leaderboard - Get leaderboard data
router.get('/leaderboard', async (req: Request, res: Response) => {
  try {
    const { type = 'weekly' } = req.query;
    const userId = req.user!.id;

    let leaderboard;

    if (type === 'weekly') {
      // Weekly XP leaders (last 7 days activity)
      leaderboard = await query<{ user_id: string; name: string; total_xp: number; current_streak: number }>(`
        SELECT u.id as user_id, u.name, COALESCE(g.total_xp, 0) as total_xp, COALESCE(g.current_streak, 0) as current_streak
        FROM users u
        LEFT JOIN user_gamification g ON u.id = g.user_id
        WHERE g.last_activity_date >= NOW() - INTERVAL '7 days'
        ORDER BY g.total_xp DESC NULLS LAST
        LIMIT 25
      `);
    } else if (type === 'alltime') {
      // All-time XP
      leaderboard = await query<{ user_id: string; name: string; total_xp: number; current_streak: number }>(`
        SELECT u.id as user_id, u.name, COALESCE(g.total_xp, 0) as total_xp, COALESCE(g.current_streak, 0) as current_streak
        FROM users u
        LEFT JOIN user_gamification g ON u.id = g.user_id
        ORDER BY g.total_xp DESC NULLS LAST
        LIMIT 25
      `);
    } else if (type === 'streaks') {
      // Longest streaks
      leaderboard = await query<{ user_id: string; name: string; total_xp: number; current_streak: number; longest_streak: number }>(`
        SELECT u.id as user_id, u.name, COALESCE(g.total_xp, 0) as total_xp,
               COALESCE(g.current_streak, 0) as current_streak,
               COALESCE(g.longest_streak, 0) as longest_streak
        FROM users u
        LEFT JOIN user_gamification g ON u.id = g.user_id
        WHERE g.longest_streak > 0
        ORDER BY g.longest_streak DESC, g.current_streak DESC
        LIMIT 25
      `);
    } else if (type === 'exams') {
      // Highest exam scores
      leaderboard = await query<{ user_id: string; name: string; total_score: number; completed_at: Date }>(`
        SELECT DISTINCT ON (u.id) u.id as user_id, u.name, e.total_score, e.completed_at
        FROM users u
        JOIN exam_attempts e ON u.id = e.user_id
        WHERE e.passed = true
        ORDER BY u.id, e.total_score DESC
      `);
      // Re-sort by score
      leaderboard.sort((a: any, b: any) => b.total_score - a.total_score);
      leaderboard = leaderboard.slice(0, 25);
    } else {
      return res.status(400).json({ error: 'Invalid leaderboard type' });
    }

    // Find current user's rank
    const userRank = leaderboard.findIndex((l: any) => l.user_id === userId) + 1;

    res.json({
      type,
      leaderboard: leaderboard.map((l: any, idx: number) => ({
        rank: idx + 1,
        userId: l.user_id,
        name: l.name,
        xp: l.total_xp,
        streak: l.current_streak,
        longestStreak: l.longest_streak,
        examScore: l.total_score,
        isCurrentUser: l.user_id === userId
      })),
      userRank: userRank > 0 ? userRank : null
    });
  } catch (error) {
    console.error('Get leaderboard error:', error);
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
});

// ============================================
// SPACED REPETITION SYSTEM
// ============================================

// GET /api/progress/review - Get cards due for review
router.get('/review', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const dueCards = await query<{
      id: string;
      question_type: string;
      question_id: string;
      question_text: string;
      correct_answer: string;
      interval_days: number;
      repetitions: number;
    }>(`
      SELECT id, question_type, question_id, question_text, correct_answer, interval_days, repetitions
      FROM review_cards
      WHERE user_id = $1 AND next_review_at <= NOW()
      ORDER BY next_review_at ASC
      LIMIT 20
    `, [userId]);

    // Get total counts
    const counts = await queryOne<{ due: string; total: string }>(`
      SELECT
        COUNT(*) FILTER (WHERE next_review_at <= NOW()) as due,
        COUNT(*) as total
      FROM review_cards WHERE user_id = $1
    `, [userId]);

    res.json({
      cards: dueCards.map(c => ({
        id: c.id,
        questionType: c.question_type,
        questionId: c.question_id,
        questionText: c.question_text,
        correctAnswer: c.correct_answer,
        intervalDays: c.interval_days,
        repetitions: c.repetitions
      })),
      dueCount: parseInt(counts?.due || '0'),
      totalCount: parseInt(counts?.total || '0')
    });
  } catch (error) {
    console.error('Get review cards error:', error);
    res.status(500).json({ error: 'Failed to get review cards' });
  }
});

// POST /api/progress/review/add - Add a card for review (when user gets something wrong)
router.post('/review/add', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { questionType, questionId, questionText, correctAnswer } = req.body;

    if (!questionType || !questionId) {
      return res.status(400).json({ error: 'questionType and questionId required' });
    }

    await query(`
      INSERT INTO review_cards (user_id, question_type, question_id, question_text, correct_answer)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, question_type, question_id)
      DO UPDATE SET
        ease_factor = 2.5,
        interval_days = 1,
        repetitions = 0,
        next_review_at = NOW()
    `, [userId, questionType, questionId, questionText || '', correctAnswer || '']);

    res.json({ success: true });
  } catch (error) {
    console.error('Add review card error:', error);
    res.status(500).json({ error: 'Failed to add review card' });
  }
});

// POST /api/progress/review/answer - Record answer to review card (SM-2 algorithm)
router.post('/review/answer', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { cardId, quality } = req.body; // quality: 0-5 (0=complete blackout, 5=perfect)

    if (!cardId || quality === undefined || quality < 0 || quality > 5) {
      return res.status(400).json({ error: 'cardId and quality (0-5) required' });
    }

    // Get current card state
    const card = await queryOne<{
      ease_factor: number;
      interval_days: number;
      repetitions: number;
    }>(`
      SELECT ease_factor, interval_days, repetitions FROM review_cards
      WHERE id = $1 AND user_id = $2
    `, [cardId, userId]);

    if (!card) {
      return res.status(404).json({ error: 'Card not found' });
    }

    // SM-2 Algorithm
    let { ease_factor, interval_days, repetitions } = card;
    const easeFactor = parseFloat(String(ease_factor));

    if (quality < 3) {
      // Failed - reset
      repetitions = 0;
      interval_days = 1;
    } else {
      // Passed
      if (repetitions === 0) {
        interval_days = 1;
      } else if (repetitions === 1) {
        interval_days = 3;
      } else {
        interval_days = Math.round(interval_days * easeFactor);
      }
      repetitions++;
    }

    // Update ease factor
    const newEaseFactor = Math.max(1.3, easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));

    // Calculate next review date
    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + interval_days);

    await query(`
      UPDATE review_cards
      SET ease_factor = $3, interval_days = $4, repetitions = $5, next_review_at = $6, last_quality = $7
      WHERE id = $1 AND user_id = $2
    `, [cardId, userId, newEaseFactor, interval_days, repetitions, nextReview, quality]);

    res.json({
      success: true,
      nextReviewAt: nextReview,
      intervalDays: interval_days
    });
  } catch (error) {
    console.error('Answer review card error:', error);
    res.status(500).json({ error: 'Failed to record answer' });
  }
});

export default router;
