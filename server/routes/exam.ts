import { Router, Request, Response } from 'express';
import { query, queryOne, pool } from '../db/connection.js';
import { requireAuth } from '../middleware/auth.js';
import { validExamDraft } from '../exam-draft.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Discover saved work without creating or consuming an attempt.
router.get('/draft', async (req: Request, res: Response) => {
  try {
    const attempt = await queryOne(`SELECT id, draft, draft_revision, draft_saved_at FROM exam_attempts
      WHERE user_id = $1 AND completed_at IS NULL ORDER BY started_at DESC NULLS LAST LIMIT 1`, [req.user!.id]);
    res.json({ attemptId: attempt?.id || null, draft: attempt?.draft || null,
      revision: attempt?.draft_revision || 0, savedAt: attempt?.draft_saved_at || null });
  } catch { res.status(500).json({ error: 'Unable to load saved exam' }); }
});

router.post('/draft', async (req: Request, res: Response) => {
  const { attemptId, draft, revision } = req.body;
  if (!/^[0-9a-f-]{36}$/i.test(attemptId || '') || !Number.isInteger(revision) || revision < 0 || !validExamDraft(draft)) {
    return res.status(400).json({ error: 'Invalid exam draft' });
  }
  const client = await pool?.connect();
  if (!client) return res.status(503).json({ error: 'Database unavailable' });
  try {
    await client.query('BEGIN');
    const { rows: [attempt] } = await client.query('SELECT * FROM exam_attempts WHERE id = $1 AND user_id = $2 FOR UPDATE', [attemptId, req.user!.id]);
    if (!attempt || attempt.completed_at) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Attempt is no longer open' });
    }
    // Retrying a request whose response was lost must not create a conflict.
    if (attempt.draft?.saveId === draft.saveId) {
      await client.query('COMMIT');
      return res.json({ success: true, revision: attempt.draft_revision, savedAt: attempt.draft_saved_at });
    }
    if (attempt.draft_revision !== revision) {
      await client.query('ROLLBACK');
      return res.json({ conflict: true });
    }
    const { rows: [saved] } = await client.query(`UPDATE exam_attempts SET draft = $3, draft_revision = draft_revision + 1,
      draft_saved_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING draft_revision, draft_saved_at`, [attemptId, req.user!.id, draft]);
    await client.query('COMMIT');
    res.json({ success: true, revision: saved.draft_revision, savedAt: saved.draft_saved_at });
  } catch {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Unable to save exam draft' });
  } finally { client.release(); }
});

// GET /api/exam/history - Get exam attempt history
router.get('/history', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const attempts = await query<{
      id: string;
      attempt_number: number;
      completed_at: Date;
      mcq_correct: number;
      fib_correct: number;
      sa_points: number;
      total_score: number;
      passed: boolean;
      time_taken_seconds: number;
    }>(`
      SELECT * FROM exam_attempts
      WHERE user_id = $1 AND completed_at IS NOT NULL
      ORDER BY attempt_number ASC
    `, [userId]);

    const certification = await queryOne<{
      certified_at: Date;
      score: number;
    }>(`
      SELECT certified_at, score FROM certifications WHERE user_id = $1
    `, [userId]);

    // Get user name for certificate
    const user = await queryOne<{ name: string }>(`
      SELECT name FROM users WHERE id = $1
    `, [userId]);

    res.json({
      attempts: attempts.map(a => ({
        id: a.id,
        attemptNumber: a.attempt_number,
        date: a.completed_at,
        mcqScore: a.mcq_correct,
        fibScore: a.fib_correct,
        saScore: a.sa_points,
        totalScore: a.total_score,
        passed: a.passed,
        timeTaken: a.time_taken_seconds
      })),
      isCertified: !!certification,
      certificationDate: certification?.certified_at,
      userName: user?.name || ''
    });
  } catch (error) {
    console.error('Get exam history error:', error);
    res.status(500).json({ error: 'Failed to get exam history' });
  }
});

// POST /api/exam/start - Start a new exam attempt
router.post('/start', async (req: Request, res: Response) => {
  const client = await pool?.connect();
  if (!client) return res.status(503).json({error: 'Database unavailable'});
  try {
    await client.query('BEGIN');
    const userId = req.user!.id;
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const cert = await client.query('SELECT id FROM certifications WHERE user_id = $1', [userId]);
    const count = await client.query('SELECT COUNT(*) FROM exam_attempts WHERE user_id = $1 AND completed_at IS NOT NULL', [userId]);
    const completed = Number(count.rows[0].count);
    if (cert.rowCount || completed >= 3) {
      await client.query('ROLLBACK');
      return res.status(409).json({error: cert.rowCount ? 'Already certified' : 'Maximum attempts reached'});
    }
    const active = await client.query('SELECT id, draft, draft_revision, draft_saved_at FROM exam_attempts WHERE user_id = $1 AND completed_at IS NULL ORDER BY started_at DESC NULLS LAST LIMIT 1', [userId]);
    const attempt = active.rows[0] || (await client.query('INSERT INTO exam_attempts (user_id, attempt_number, started_at) VALUES ($1, $2, NOW()) RETURNING id', [userId, completed + 1])).rows[0];
    await client.query('COMMIT');
    res.json({attemptId: attempt.id, attemptNumber: completed + 1, remainingAttempts: 3 - completed, resumed: !!active.rowCount,
      draft: attempt.draft || null, revision: attempt.draft_revision || 0, savedAt: attempt.draft_saved_at || null});
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Start exam error:', error);
    res.status(500).json({error: 'Unable to start exam. Please retry.'});
  } finally { client.release(); }
});

// POST /api/exam/submit - Submit exam answers
router.post('/submit', async (req: Request, res: Response) => {
  const {attemptId, mcqAnswers, fibAnswers, saAnswers, timeTaken, results} = req.body;
  if (!/^[0-9a-f-]{36}$/i.test(attemptId || '') || !results ||
      !['mcqCorrect','fibCorrect','saPoints','totalScore'].every(k => Number.isInteger(results[k]) && results[k] >= 0) ||
      results.totalScore > 100 || results.passed !== (results.totalScore >= 70)) {
    return res.status(400).json({error: 'Invalid exam submission'});
  }
  const client = await pool?.connect();
  if (!client) return res.status(503).json({error: 'Database unavailable'});
  try {
    await client.query('BEGIN');
    const userId = req.user!.id;
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const found = await client.query('SELECT * FROM exam_attempts WHERE id = $1 AND user_id = $2 FOR UPDATE', [attemptId, userId]);
    const attempt = found.rows[0];
    if (!attempt) {
      await client.query('ROLLBACK');
      return res.status(404).json({error: 'Attempt not found'});
    }
    const count = await client.query('SELECT COUNT(*) FROM exam_attempts WHERE user_id = $1 AND completed_at IS NOT NULL', [userId]);
    const completed = Number(count.rows[0].count);
    // A repeated POST after a lost response returns the original result unchanged.
    if (attempt.completed_at) {
      await client.query('COMMIT');
      return res.json({success: true, passed: attempt.passed, score: attempt.total_score, remainingAttempts: Math.max(0, 3 - completed)});
    }
    const cert = await client.query('SELECT id FROM certifications WHERE user_id = $1', [userId]);
    if (completed >= 3 || cert.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({error: 'Exam already completed or attempt limit reached'});
    }
    await client.query(`UPDATE exam_attempts SET completed_at = NOW(), attempt_number = $9,
      mcq_correct = $2, fib_correct = $3, sa_points = $4, total_score = $5, passed = $6,
      time_taken_seconds = $7 WHERE id = $1 AND user_id = $8`,
      [attemptId, results.mcqCorrect, results.fibCorrect, results.saPoints, results.totalScore, results.passed, timeTaken, userId, completed + 1]);
    // Store individual answers if provided
    if (mcqAnswers && Array.isArray(mcqAnswers)) {
      for (const answer of mcqAnswers) {
        await client.query(`
          INSERT INTO exam_answers (attempt_id, question_type, question_id, question_number, question_text, user_answer, correct_answer, is_correct, points_earned)
          VALUES ($1, 'mcq', $2, $3, $4, $5, $6, $7, $8)
        `, [attemptId, answer.questionId, answer.questionNumber, answer.questionText, answer.userAnswer, answer.correctAnswer, answer.isCorrect, answer.isCorrect ? 2 : 0]);
      }
    }

    if (fibAnswers && Array.isArray(fibAnswers)) {
      for (const answer of fibAnswers) {
        await client.query(`
          INSERT INTO exam_answers (attempt_id, question_type, question_id, question_number, question_text, user_answer, correct_answer, is_correct, points_earned)
          VALUES ($1, 'fib', $2, $3, $4, $5, $6, $7, $8)
        `, [attemptId, answer.questionId, answer.questionNumber, answer.questionText, answer.userAnswer, answer.correctAnswer, answer.isCorrect, answer.isCorrect ? 2 : 0]);
      }
    }

    if (saAnswers && Array.isArray(saAnswers)) {
      for (const answer of saAnswers) {
        await client.query(`
          INSERT INTO exam_answers (attempt_id, question_type, question_id, question_number, question_text, user_answer, correct_answer, is_correct, points_earned)
          VALUES ($1, 'sa', $2, $3, $4, $5, $6, $7, $8)
        `, [attemptId, answer.questionId, answer.questionNumber, answer.questionText, answer.userAnswer, answer.correctAnswer, answer.isCorrect, Math.round(answer.pointsEarned)]);
      }
    }


    if (results.passed) {
      await client.query(`INSERT INTO certifications (user_id, passing_attempt_id, certificate_name, score)
        SELECT id, $2, name, $3 FROM users WHERE id = $1 ON CONFLICT (user_id) DO NOTHING`,
        [userId, attemptId, results.totalScore]);
    }
    await client.query('COMMIT');
    res.json({success: true, passed: results.passed, score: results.totalScore, remainingAttempts: Math.max(0, 2 - completed)});
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Submit exam error:', error);
    res.status(500).json({error: 'Submission was not saved. Retry the same attempt.'});
  } finally { client.release(); }
});

// GET /api/exam/answers/:attemptId - Get detailed answers for an attempt
router.get('/answers/:attemptId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { attemptId } = req.params;

    // Verify attempt belongs to user or user is manager
    const attempt = await queryOne<{ user_id: string }>(`
      SELECT user_id FROM exam_attempts WHERE id = $1
    `, [attemptId]);

    if (!attempt) {
      return res.status(404).json({ error: 'Attempt not found' });
    }

    if (attempt.user_id !== userId && !req.user!.isManager) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const answers = await query<{
      question_type: string;
      question_id: string;
      question_number: number;
      question_text: string;
      user_answer: string;
      correct_answer: string;
      is_correct: boolean;
      points_earned: number;
    }>(`
      SELECT * FROM exam_answers WHERE attempt_id = $1
      ORDER BY question_type, question_number
    `, [attemptId]);

    res.json({
      answers: answers.map(a => ({
        type: a.question_type,
        questionId: a.question_id,
        questionNumber: a.question_number,
        questionText: a.question_text,
        userAnswer: a.user_answer,
        correctAnswer: a.correct_answer,
        isCorrect: a.is_correct,
        pointsEarned: a.points_earned
      }))
    });
  } catch (error) {
    console.error('Get exam answers error:', error);
    res.status(500).json({ error: 'Failed to get exam answers' });
  }
});

export default router;
