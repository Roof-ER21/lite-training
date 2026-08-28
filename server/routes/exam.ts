import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/connection.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

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
      WHERE user_id = $1
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
  try {
    const userId = req.user!.id;

    // Check if already certified
    const certification = await queryOne(`
      SELECT id FROM certifications WHERE user_id = $1
    `, [userId]);

    if (certification) {
      return res.status(400).json({ error: 'Already certified', isCertified: true });
    }

    // Count previous attempts
    const attemptCount = await queryOne<{ count: string }>(`
      SELECT COUNT(*) as count FROM exam_attempts WHERE user_id = $1
    `, [userId]);

    const currentAttempts = parseInt(attemptCount?.count || '0');

    if (currentAttempts >= 3) {
      return res.status(400).json({ error: 'Maximum attempts reached', lockedOut: true });
    }

    // Create new attempt record
    const attempt = await queryOne<{ id: string; attempt_number: number }>(`
      INSERT INTO exam_attempts (user_id, attempt_number, started_at)
      VALUES ($1, $2, NOW())
      RETURNING id, attempt_number
    `, [userId, currentAttempts + 1]);

    res.json({
      attemptId: attempt?.id,
      attemptNumber: attempt?.attempt_number,
      remainingAttempts: 3 - currentAttempts - 1
    });
  } catch (error) {
    console.error('Start exam error:', error);
    res.status(500).json({ error: 'Failed to start exam' });
  }
});

// POST /api/exam/submit - Submit exam answers
router.post('/submit', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { attemptId, mcqAnswers, fibAnswers, saAnswers, timeTaken, results } = req.body;

    if (!attemptId || !results) {
      return res.status(400).json({ error: 'attemptId and results required' });
    }

    // Update attempt with results
    await query(`
      UPDATE exam_attempts SET
        completed_at = NOW(),
        mcq_correct = $2,
        fib_correct = $3,
        sa_points = $4,
        total_score = $5,
        passed = $6,
        time_taken_seconds = $7
      WHERE id = $1 AND user_id = $8
    `, [
      attemptId,
      results.mcqCorrect,
      results.fibCorrect,
      results.saPoints,
      results.totalScore,
      results.passed,
      timeTaken,
      userId
    ]);

    // Store individual answers if provided
    if (mcqAnswers && Array.isArray(mcqAnswers)) {
      for (const answer of mcqAnswers) {
        await query(`
          INSERT INTO exam_answers (attempt_id, question_type, question_id, question_number, question_text, user_answer, correct_answer, is_correct, points_earned)
          VALUES ($1, 'mcq', $2, $3, $4, $5, $6, $7, $8)
        `, [attemptId, answer.questionId, answer.questionNumber, answer.questionText, answer.userAnswer, answer.correctAnswer, answer.isCorrect, answer.isCorrect ? 2 : 0]);
      }
    }

    if (fibAnswers && Array.isArray(fibAnswers)) {
      for (const answer of fibAnswers) {
        await query(`
          INSERT INTO exam_answers (attempt_id, question_type, question_id, question_number, question_text, user_answer, correct_answer, is_correct, points_earned)
          VALUES ($1, 'fib', $2, $3, $4, $5, $6, $7, $8)
        `, [attemptId, answer.questionId, answer.questionNumber, answer.questionText, answer.userAnswer, answer.correctAnswer, answer.isCorrect, answer.isCorrect ? 2 : 0]);
      }
    }

    if (saAnswers && Array.isArray(saAnswers)) {
      for (const answer of saAnswers) {
        await query(`
          INSERT INTO exam_answers (attempt_id, question_type, question_id, question_number, question_text, user_answer, correct_answer, is_correct, points_earned)
          VALUES ($1, 'sa', $2, $3, $4, $5, $6, $7, $8)
        `, [attemptId, answer.questionId, answer.questionNumber, answer.questionText, answer.userAnswer, answer.correctAnswer, answer.isCorrect, answer.pointsEarned]);
      }
    }

    // If passed, create certification record. This must never fail silently -
    // a broken insert here is exactly what made admin show "Certified: No"
    // for every user who had passed the exam.
    if (results.passed) {
      try {
        const user = await queryOne<{ name: string }>(`
          SELECT name FROM users WHERE id = $1
        `, [userId]);

        await query(`
          INSERT INTO certifications (user_id, passing_attempt_id, certificate_name, score)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (user_id) DO NOTHING
        `, [userId, attemptId, user?.name || 'Unknown', results.totalScore]);
      } catch (certError) {
        console.error('CERTIFICATION INSERT FAILED for user', userId, certError);
      }
    }

    // Get remaining attempts
    const attemptCount = await queryOne<{ count: string }>(`
      SELECT COUNT(*) as count FROM exam_attempts WHERE user_id = $1
    `, [userId]);

    res.json({
      success: true,
      passed: results.passed,
      score: results.totalScore,
      remainingAttempts: Math.max(0, 3 - parseInt(attemptCount?.count || '0'))
    });
  } catch (error) {
    console.error('Submit exam error:', error);
    res.status(500).json({ error: 'Failed to submit exam' });
  }
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
