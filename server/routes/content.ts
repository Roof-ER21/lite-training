import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/connection.js';

const router = Router();

// ============================================
// PUBLIC CONTENT DELIVERY (No auth required)
// These endpoints serve published content to regular users
// ============================================

// GET /api/content/modules/:id - Get published module HTML
router.get('/modules/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Get published content for this module
    const content = await queryOne<{
      html_content: string;
      version: number;
      published_at: Date;
    }>(`
      SELECT html_content, version, published_at
      FROM cms_module_content
      WHERE module_id = $1 AND status = 'published'
      ORDER BY version DESC
      LIMIT 1
    `, [id]);

    if (!content) {
      return res.status(404).json({ error: 'Module content not found', useFallback: true });
    }

    res.json({
      moduleId: id,
      htmlContent: content.html_content,
      version: content.version,
      publishedAt: content.published_at
    });
  } catch (error) {
    console.error('Get module content error:', error);
    res.status(500).json({ error: 'Failed to get module content', useFallback: true });
  }
});

// GET /api/content/exam/questions - Get active exam questions
router.get('/exam/questions', async (req: Request, res: Response) => {
  try {
    const questions = await query<{
      id: string;
      question_type: string;
      module_reference: number;
      question_text: string;
      options: any;
      correct_answer_index: number;
      acceptable_answers: string[];
      keywords: string[];
      min_keywords: number;
      sample_answer: string;
      explanation: string;
      points: number;
      order_index: number;
    }>(`
      SELECT * FROM cms_exam_questions
      WHERE is_active = TRUE
      ORDER BY question_type, order_index ASC
    `);

    // Separate by type
    const mcq = questions.filter(q => q.question_type === 'mcq').map(q => ({
      id: q.id,
      module: q.module_reference,
      question: q.question_text,
      options: q.options,
      correctAnswer: q.correct_answer_index,
      explanation: q.explanation
    }));

    const fib = questions.filter(q => q.question_type === 'fib').map(q => ({
      id: q.id,
      module: q.module_reference,
      question: q.question_text,
      acceptableAnswers: q.acceptable_answers,
      explanation: q.explanation
    }));

    const sa = questions.filter(q => q.question_type === 'sa').map(q => ({
      id: q.id,
      module: q.module_reference,
      prompt: q.question_text,
      keywords: q.keywords,
      minKeywords: q.min_keywords,
      sampleAnswer: q.sample_answer
    }));

    res.json({
      mcq,
      fib,
      sa,
      totalCount: questions.length,
      useFallback: questions.length === 0
    });
  } catch (error) {
    console.error('Get exam questions error:', error);
    res.status(500).json({ error: 'Failed to get exam questions', useFallback: true });
  }
});

// GET /api/content/scenarios/:packId - Get scenarios for a pack
router.get('/scenarios/:packId', async (req: Request, res: Response) => {
  try {
    const { packId } = req.params;

    const scenarios = await query<{
      id: string;
      role: string;
      prompt: string;
      expected_key_points: string[];
      rubric: any;
      follow_ups: string[];
      difficulty: string;
      order_index: number;
    }>(`
      SELECT * FROM cms_roleplay_scenarios
      WHERE pack_id = $1 AND is_active = TRUE
      ORDER BY order_index ASC
    `, [packId]);

    if (scenarios.length === 0) {
      return res.json({ scenarios: [], useFallback: true });
    }

    res.json({
      scenarios: scenarios.map(s => ({
        id: s.id,
        role: s.role,
        prompt: s.prompt,
        expectedKeyPoints: s.expected_key_points,
        rubric: s.rubric,
        followUps: s.follow_ups,
        difficulty: s.difficulty
      })),
      useFallback: false
    });
  } catch (error) {
    console.error('Get scenarios error:', error);
    res.status(500).json({ error: 'Failed to get scenarios', useFallback: true });
  }
});

// GET /api/content/scenarios - Get all scenarios grouped by pack
router.get('/scenarios', async (req: Request, res: Response) => {
  try {
    const packs = await query<{
      id: string;
      title: string;
      trainer_tips: string[];
      order_index: number;
    }>(`
      SELECT * FROM cms_roleplay_packs
      WHERE is_active = TRUE
      ORDER BY order_index ASC
    `);

    const result: Record<string, any> = {};

    for (const pack of packs) {
      const scenarios = await query<{
        id: string;
        role: string;
        prompt: string;
        expected_key_points: string[];
        rubric: any;
        follow_ups: string[];
        difficulty: string;
      }>(`
        SELECT * FROM cms_roleplay_scenarios
        WHERE pack_id = $1 AND is_active = TRUE
        ORDER BY order_index ASC
      `, [pack.id]);

      result[pack.id] = {
        trainerTips: pack.trainer_tips || [],
        scenarios: scenarios.map(s => ({
          id: s.id,
          role: s.role,
          prompt: s.prompt,
          expectedKeyPoints: s.expected_key_points,
          rubric: s.rubric,
          followUps: s.follow_ups
        }))
      };
    }

    res.json({
      packs: result,
      useFallback: packs.length === 0
    });
  } catch (error) {
    console.error('Get all scenarios error:', error);
    res.status(500).json({ error: 'Failed to get scenarios', useFallback: true });
  }
});

export default router;
