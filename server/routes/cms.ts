import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/connection.js';
import { requireSuperAdmin, logAdminAction } from '../middleware/superadmin.js';

const router = Router();

// All CMS routes require super admin authentication
router.use(requireSuperAdmin);

// ============================================
// MODULE MANAGEMENT
// ============================================

// GET /api/cms/modules - List all modules
router.get('/modules', async (req: Request, res: Response) => {
  try {
    const modules = await query<{
      id: string;
      title: string;
      order_index: number;
      is_active: boolean;
      created_at: Date;
      updated_at: Date;
    }>(`
      SELECT * FROM cms_modules ORDER BY order_index ASC
    `);

    // Get latest content version for each module
    const modulesWithContent = await Promise.all(modules.map(async (mod) => {
      const latestContent = await queryOne<{
        version: number;
        status: string;
        published_at: Date;
      }>(`
        SELECT version, status, published_at
        FROM cms_module_content
        WHERE module_id = $1
        ORDER BY version DESC
        LIMIT 1
      `, [mod.id]);

      return {
        id: mod.id,
        title: mod.title,
        orderIndex: mod.order_index,
        isActive: mod.is_active,
        createdAt: mod.created_at,
        updatedAt: mod.updated_at,
        latestVersion: latestContent?.version || 0,
        status: latestContent?.status || 'none',
        publishedAt: latestContent?.published_at
      };
    }));

    res.json({ modules: modulesWithContent });
  } catch (error) {
    console.error('Get modules error:', error);
    res.status(500).json({ error: 'Failed to get modules' });
  }
});

// GET /api/cms/modules/:id - Get module with content
router.get('/modules/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const version = req.query.version as string;

    const mod = await queryOne<{
      id: string;
      title: string;
      order_index: number;
      is_active: boolean;
    }>(`
      SELECT * FROM cms_modules WHERE id = $1
    `, [id]);

    if (!mod) {
      return res.status(404).json({ error: 'Module not found' });
    }

    // Get specific version or latest
    let content;
    if (version) {
      content = await queryOne(`
        SELECT * FROM cms_module_content
        WHERE module_id = $1 AND version = $2
      `, [id, parseInt(version)]);
    } else {
      content = await queryOne(`
        SELECT * FROM cms_module_content
        WHERE module_id = $1
        ORDER BY version DESC
        LIMIT 1
      `, [id]);
    }

    // Get all versions for history
    const versions = await query<{
      version: number;
      status: string;
      created_at: Date;
      published_at: Date;
    }>(`
      SELECT version, status, created_at, published_at
      FROM cms_module_content
      WHERE module_id = $1
      ORDER BY version DESC
    `, [id]);

    res.json({
      module: {
        id: mod.id,
        title: mod.title,
        orderIndex: mod.order_index,
        isActive: mod.is_active
      },
      content: content ? {
        version: content.version,
        status: content.status,
        htmlContent: content.html_content,
        createdAt: content.created_at,
        publishedAt: content.published_at
      } : null,
      versions: versions.map(v => ({
        version: v.version,
        status: v.status,
        createdAt: v.created_at,
        publishedAt: v.published_at
      }))
    });
  } catch (error) {
    console.error('Get module error:', error);
    res.status(500).json({ error: 'Failed to get module' });
  }
});

// POST /api/cms/modules - Create new module
router.post('/modules', async (req: Request, res: Response) => {
  try {
    const { id, title, orderIndex } = req.body;

    if (!id || !title) {
      return res.status(400).json({ error: 'Module ID and title required' });
    }

    // Check if module already exists
    const existing = await queryOne(`SELECT id FROM cms_modules WHERE id = $1`, [id]);
    if (existing) {
      return res.status(400).json({ error: 'Module ID already exists' });
    }

    await query(`
      INSERT INTO cms_modules (id, title, order_index)
      VALUES ($1, $2, $3)
    `, [id, title, orderIndex || 0]);

    await logAdminAction(req.admin!.id, 'create', 'module', id, null, { id, title, orderIndex });

    res.json({ success: true, id });
  } catch (error) {
    console.error('Create module error:', error);
    res.status(500).json({ error: 'Failed to create module' });
  }
});

// PUT /api/cms/modules/:id - Update module metadata
router.put('/modules/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, orderIndex, isActive } = req.body;

    const existing = await queryOne(`SELECT * FROM cms_modules WHERE id = $1`, [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Module not found' });
    }

    await query(`
      UPDATE cms_modules
      SET title = COALESCE($2, title),
          order_index = COALESCE($3, order_index),
          is_active = COALESCE($4, is_active),
          updated_at = NOW()
      WHERE id = $1
    `, [id, title, orderIndex, isActive]);

    await logAdminAction(req.admin!.id, 'update', 'module', id, existing, { title, orderIndex, isActive });

    res.json({ success: true });
  } catch (error) {
    console.error('Update module error:', error);
    res.status(500).json({ error: 'Failed to update module' });
  }
});

// POST /api/cms/modules/:id/content - Create new content version (draft)
router.post('/modules/:id/content', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { htmlContent } = req.body;

    if (!htmlContent) {
      return res.status(400).json({ error: 'HTML content required' });
    }

    // Get latest version number
    const latest = await queryOne<{ version: number }>(`
      SELECT MAX(version) as version FROM cms_module_content WHERE module_id = $1
    `, [id]);

    const newVersion = (latest?.version || 0) + 1;

    await query(`
      INSERT INTO cms_module_content (module_id, version, status, html_content)
      VALUES ($1, $2, 'draft', $3)
    `, [id, newVersion, htmlContent]);

    await logAdminAction(req.admin!.id, 'create_draft', 'module_content', id, null, { version: newVersion });

    res.json({ success: true, version: newVersion });
  } catch (error) {
    console.error('Create content error:', error);
    res.status(500).json({ error: 'Failed to create content' });
  }
});

// PUT /api/cms/modules/:id/content/:version - Update draft content
router.put('/modules/:id/content/:version', async (req: Request, res: Response) => {
  try {
    const { id, version } = req.params;
    const { htmlContent } = req.body;

    // Check if it's a draft
    const content = await queryOne<{ status: string }>(`
      SELECT status FROM cms_module_content WHERE module_id = $1 AND version = $2
    `, [id, version]);

    if (!content) {
      return res.status(404).json({ error: 'Content version not found' });
    }

    if (content.status === 'published') {
      return res.status(400).json({ error: 'Cannot edit published content. Create a new version.' });
    }

    await query(`
      UPDATE cms_module_content
      SET html_content = $3, updated_at = NOW()
      WHERE module_id = $1 AND version = $2
    `, [id, version, htmlContent]);

    await logAdminAction(req.admin!.id, 'update_draft', 'module_content', id, null, { version });

    res.json({ success: true });
  } catch (error) {
    console.error('Update content error:', error);
    res.status(500).json({ error: 'Failed to update content' });
  }
});

// POST /api/cms/modules/:id/publish - Publish a draft version
router.post('/modules/:id/publish', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { version } = req.body;

    // Archive current published version
    await query(`
      UPDATE cms_module_content
      SET status = 'archived'
      WHERE module_id = $1 AND status = 'published'
    `, [id]);

    // Publish the specified version
    await query(`
      UPDATE cms_module_content
      SET status = 'published', published_at = NOW()
      WHERE module_id = $1 AND version = $2
    `, [id, version]);

    await logAdminAction(req.admin!.id, 'publish', 'module_content', id, null, { version });

    res.json({ success: true });
  } catch (error) {
    console.error('Publish error:', error);
    res.status(500).json({ error: 'Failed to publish content' });
  }
});

// ============================================
// EXAM QUESTION MANAGEMENT
// ============================================

// GET /api/cms/exam/questions - List all questions
router.get('/exam/questions', async (req: Request, res: Response) => {
  try {
    const type = req.query.type as string;

    let whereClause = '';
    const params: any[] = [];

    if (type) {
      whereClause = 'WHERE question_type = $1';
      params.push(type);
    }

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
      is_active: boolean;
      order_index: number;
    }>(`
      SELECT * FROM cms_exam_questions
      ${whereClause}
      ORDER BY question_type, order_index ASC
    `, params);

    res.json({
      questions: questions.map(q => ({
        id: q.id,
        type: q.question_type,
        moduleReference: q.module_reference,
        questionText: q.question_text,
        options: q.options,
        correctAnswerIndex: q.correct_answer_index,
        acceptableAnswers: q.acceptable_answers,
        keywords: q.keywords,
        minKeywords: q.min_keywords,
        sampleAnswer: q.sample_answer,
        explanation: q.explanation,
        points: q.points,
        isActive: q.is_active,
        orderIndex: q.order_index
      }))
    });
  } catch (error) {
    console.error('Get questions error:', error);
    res.status(500).json({ error: 'Failed to get questions' });
  }
});

// POST /api/cms/exam/questions - Create question
router.post('/exam/questions', async (req: Request, res: Response) => {
  try {
    const {
      id, type, moduleReference, questionText, options,
      correctAnswerIndex, acceptableAnswers, keywords,
      minKeywords, sampleAnswer, explanation, points, orderIndex
    } = req.body;

    if (!id || !type || !questionText) {
      return res.status(400).json({ error: 'ID, type, and question text required' });
    }

    await query(`
      INSERT INTO cms_exam_questions (
        id, question_type, module_reference, question_text, options,
        correct_answer_index, acceptable_answers, keywords,
        min_keywords, sample_answer, explanation, points, order_index
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [
      id, type, moduleReference, questionText,
      options ? JSON.stringify(options) : null,
      correctAnswerIndex, acceptableAnswers, keywords,
      minKeywords, sampleAnswer, explanation, points || 2, orderIndex || 0
    ]);

    await logAdminAction(req.admin!.id, 'create', 'exam_question', id, null, { type, questionText });

    res.json({ success: true, id });
  } catch (error) {
    console.error('Create question error:', error);
    res.status(500).json({ error: 'Failed to create question' });
  }
});

// PUT /api/cms/exam/questions/:id - Update question
router.put('/exam/questions/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      questionText, options, correctAnswerIndex, acceptableAnswers,
      keywords, minKeywords, sampleAnswer, explanation, points, isActive, orderIndex
    } = req.body;

    const existing = await queryOne(`SELECT * FROM cms_exam_questions WHERE id = $1`, [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Question not found' });
    }

    await query(`
      UPDATE cms_exam_questions SET
        question_text = COALESCE($2, question_text),
        options = COALESCE($3, options),
        correct_answer_index = COALESCE($4, correct_answer_index),
        acceptable_answers = COALESCE($5, acceptable_answers),
        keywords = COALESCE($6, keywords),
        min_keywords = COALESCE($7, min_keywords),
        sample_answer = COALESCE($8, sample_answer),
        explanation = COALESCE($9, explanation),
        points = COALESCE($10, points),
        is_active = COALESCE($11, is_active),
        order_index = COALESCE($12, order_index),
        updated_at = NOW()
      WHERE id = $1
    `, [
      id, questionText,
      options ? JSON.stringify(options) : null,
      correctAnswerIndex, acceptableAnswers, keywords,
      minKeywords, sampleAnswer, explanation, points, isActive, orderIndex
    ]);

    await logAdminAction(req.admin!.id, 'update', 'exam_question', id, existing, req.body);

    res.json({ success: true });
  } catch (error) {
    console.error('Update question error:', error);
    res.status(500).json({ error: 'Failed to update question' });
  }
});

// DELETE /api/cms/exam/questions/:id - Soft delete question
router.delete('/exam/questions/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await query(`
      UPDATE cms_exam_questions SET is_active = FALSE, updated_at = NOW() WHERE id = $1
    `, [id]);

    await logAdminAction(req.admin!.id, 'delete', 'exam_question', id, null, null);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete question error:', error);
    res.status(500).json({ error: 'Failed to delete question' });
  }
});

// ============================================
// ROLE-PLAY SCENARIO MANAGEMENT
// ============================================

// GET /api/cms/scenarios/packs - List all packs
router.get('/scenarios/packs', async (req: Request, res: Response) => {
  try {
    const packs = await query<{
      id: string;
      title: string;
      trainer_tips: string[];
      order_index: number;
      is_active: boolean;
    }>(`
      SELECT * FROM cms_roleplay_packs ORDER BY order_index ASC
    `);

    // Get scenario count per pack
    const packsWithCount = await Promise.all(packs.map(async (pack) => {
      const count = await queryOne<{ count: string }>(`
        SELECT COUNT(*) as count FROM cms_roleplay_scenarios WHERE pack_id = $1 AND is_active = TRUE
      `, [pack.id]);

      return {
        id: pack.id,
        title: pack.title,
        trainerTips: pack.trainer_tips,
        orderIndex: pack.order_index,
        isActive: pack.is_active,
        scenarioCount: parseInt(count?.count || '0')
      };
    }));

    res.json({ packs: packsWithCount });
  } catch (error) {
    console.error('Get packs error:', error);
    res.status(500).json({ error: 'Failed to get packs' });
  }
});

// POST /api/cms/scenarios/packs - Create pack
router.post('/scenarios/packs', async (req: Request, res: Response) => {
  try {
    const { id, title, trainerTips, orderIndex } = req.body;

    if (!id || !title) {
      return res.status(400).json({ error: 'Pack ID and title required' });
    }

    await query(`
      INSERT INTO cms_roleplay_packs (id, title, trainer_tips, order_index)
      VALUES ($1, $2, $3, $4)
    `, [id, title, trainerTips || [], orderIndex || 0]);

    await logAdminAction(req.admin!.id, 'create', 'roleplay_pack', id, null, { title });

    res.json({ success: true, id });
  } catch (error) {
    console.error('Create pack error:', error);
    res.status(500).json({ error: 'Failed to create pack' });
  }
});

// GET /api/cms/scenarios - List all scenarios
router.get('/scenarios', async (req: Request, res: Response) => {
  try {
    const packId = req.query.packId as string;

    let whereClause = '';
    const params: any[] = [];

    if (packId) {
      whereClause = 'WHERE pack_id = $1';
      params.push(packId);
    }

    const scenarios = await query<{
      id: string;
      pack_id: string;
      role: string;
      prompt: string;
      expected_key_points: string[];
      rubric: any;
      follow_ups: string[];
      difficulty: string;
      is_active: boolean;
      order_index: number;
    }>(`
      SELECT * FROM cms_roleplay_scenarios
      ${whereClause}
      ORDER BY pack_id, order_index ASC
    `, params);

    res.json({
      scenarios: scenarios.map(s => ({
        id: s.id,
        packId: s.pack_id,
        role: s.role,
        prompt: s.prompt,
        expectedKeyPoints: s.expected_key_points,
        rubric: s.rubric,
        followUps: s.follow_ups,
        difficulty: s.difficulty,
        isActive: s.is_active,
        orderIndex: s.order_index
      }))
    });
  } catch (error) {
    console.error('Get scenarios error:', error);
    res.status(500).json({ error: 'Failed to get scenarios' });
  }
});

// POST /api/cms/scenarios - Create scenario
router.post('/scenarios', async (req: Request, res: Response) => {
  try {
    const {
      id, packId, role, prompt, expectedKeyPoints,
      rubric, followUps, difficulty, orderIndex
    } = req.body;

    if (!id || !packId || !role || !prompt) {
      return res.status(400).json({ error: 'ID, pack ID, role, and prompt required' });
    }

    await query(`
      INSERT INTO cms_roleplay_scenarios (
        id, pack_id, role, prompt, expected_key_points,
        rubric, follow_ups, difficulty, order_index
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      id, packId, role, prompt, expectedKeyPoints || [],
      JSON.stringify(rubric || {}), followUps || [],
      difficulty || 'medium', orderIndex || 0
    ]);

    await logAdminAction(req.admin!.id, 'create', 'roleplay_scenario', id, null, { packId, role, prompt });

    res.json({ success: true, id });
  } catch (error) {
    console.error('Create scenario error:', error);
    res.status(500).json({ error: 'Failed to create scenario' });
  }
});

// PUT /api/cms/scenarios/:id - Update scenario
router.put('/scenarios/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      role, prompt, expectedKeyPoints, rubric,
      followUps, difficulty, isActive, orderIndex
    } = req.body;

    const existing = await queryOne(`SELECT * FROM cms_roleplay_scenarios WHERE id = $1`, [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Scenario not found' });
    }

    await query(`
      UPDATE cms_roleplay_scenarios SET
        role = COALESCE($2, role),
        prompt = COALESCE($3, prompt),
        expected_key_points = COALESCE($4, expected_key_points),
        rubric = COALESCE($5, rubric),
        follow_ups = COALESCE($6, follow_ups),
        difficulty = COALESCE($7, difficulty),
        is_active = COALESCE($8, is_active),
        order_index = COALESCE($9, order_index),
        updated_at = NOW()
      WHERE id = $1
    `, [
      id, role, prompt, expectedKeyPoints,
      rubric ? JSON.stringify(rubric) : null,
      followUps, difficulty, isActive, orderIndex
    ]);

    await logAdminAction(req.admin!.id, 'update', 'roleplay_scenario', id, existing, req.body);

    res.json({ success: true });
  } catch (error) {
    console.error('Update scenario error:', error);
    res.status(500).json({ error: 'Failed to update scenario' });
  }
});

// DELETE /api/cms/scenarios/:id - Soft delete scenario
router.delete('/scenarios/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await query(`
      UPDATE cms_roleplay_scenarios SET is_active = FALSE, updated_at = NOW() WHERE id = $1
    `, [id]);

    await logAdminAction(req.admin!.id, 'delete', 'roleplay_scenario', id, null, null);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete scenario error:', error);
    res.status(500).json({ error: 'Failed to delete scenario' });
  }
});

// ============================================
// SEEDING / IMPORT ENDPOINTS
// ============================================

// POST /api/cms/seed-modules - Import modules from frontend trainingContent
router.post('/seed-modules', async (req: Request, res: Response) => {
  try {
    const { modules } = req.body as {
      modules: Array<{
        id: string;
        title: string;
        orderIndex: number;
        htmlContent: string;
      }>;
    };

    if (!modules || !Array.isArray(modules) || modules.length === 0) {
      return res.status(400).json({ error: 'No modules provided' });
    }

    let seededCount = 0;
    let skippedCount = 0;

    for (const mod of modules) {
      // Check if module already exists
      const existing = await queryOne<{ id: string }>(`
        SELECT id FROM cms_modules WHERE id = $1
      `, [mod.id]);

      if (existing) {
        skippedCount++;
        continue;
      }

      // Insert module
      await query(`
        INSERT INTO cms_modules (id, title, order_index, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, TRUE, NOW(), NOW())
      `, [mod.id, mod.title, mod.orderIndex]);

      // Insert published content (version 1)
      await query(`
        INSERT INTO cms_module_content (id, module_id, version, status, html_content, published_at, created_at, updated_at)
        VALUES (gen_random_uuid(), $1, 1, 'published', $2, NOW(), NOW(), NOW())
      `, [mod.id, mod.htmlContent]);

      seededCount++;
    }

    await logAdminAction(req.admin!.id, 'seed', 'modules', null, null, { seededCount, skippedCount });

    res.json({
      success: true,
      seededCount,
      skippedCount,
      message: `Seeded ${seededCount} modules, skipped ${skippedCount} existing`
    });
  } catch (error) {
    console.error('Seed modules error:', error);
    res.status(500).json({ error: 'Failed to seed modules' });
  }
});

// POST /api/cms/seed-exam-questions - Import exam questions from frontend
router.post('/seed-exam-questions', async (req: Request, res: Response) => {
  try {
    const { questions } = req.body as {
      questions: Array<{
        id: string;
        type: 'mcq' | 'fib' | 'sa';
        moduleReference: number;
        questionText: string;
        options?: string[];
        correctAnswerIndex?: number;
        acceptableAnswers?: string[];
        keywords?: string[];
        minKeywords?: number;
        sampleAnswer?: string;
        explanation?: string;
      }>;
    };

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'No questions provided' });
    }

    let seededCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];

      // Check if question already exists
      const existing = await queryOne<{ id: string }>(`
        SELECT id FROM cms_exam_questions WHERE id = $1
      `, [q.id]);

      if (existing) {
        skippedCount++;
        continue;
      }

      // Insert question
      await query(`
        INSERT INTO cms_exam_questions (
          id, question_type, module_reference, question_text,
          options, correct_answer_index, acceptable_answers,
          keywords, min_keywords, sample_answer, explanation,
          points, is_active, order_index, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 2, TRUE, $12, NOW(), NOW())
      `, [
        q.id,
        q.type,
        q.moduleReference,
        q.questionText,
        q.options ? JSON.stringify(q.options) : null,
        q.correctAnswerIndex ?? null,
        q.acceptableAnswers || null,
        q.keywords || null,
        q.minKeywords ?? null,
        q.sampleAnswer || null,
        q.explanation || null,
        i
      ]);

      seededCount++;
    }

    await logAdminAction(req.admin!.id, 'seed', 'exam_questions', null, null, { seededCount, skippedCount });

    res.json({
      success: true,
      seededCount,
      skippedCount,
      message: `Seeded ${seededCount} questions, skipped ${skippedCount} existing`
    });
  } catch (error) {
    console.error('Seed exam questions error:', error);
    res.status(500).json({ error: 'Failed to seed exam questions' });
  }
});

// ============================================
// PUBLIC CONTENT DELIVERY (No auth required for these)
// ============================================

// These routes would be on a separate router without requireSuperAdmin
// For now, we'll expose them through the same router but the frontend
// will call them without admin auth

export default router;
