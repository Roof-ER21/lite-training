import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/connection.js';

const router = Router();

// GET /api/content/modules/:id - Get published content for a module (public, no auth)
router.get('/modules/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Get the latest published content for this module
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
      return res.status(404).json({ error: 'Module content not found' });
    }

    res.json({
      moduleId: id,
      htmlContent: content.html_content,
      version: content.version,
      publishedAt: content.published_at
    });
  } catch (error) {
    console.error('Get module content error:', error);
    res.status(500).json({ error: 'Failed to get module content' });
  }
});

// GET /api/content/modules - Get all published modules (public, no auth)
router.get('/modules', async (req: Request, res: Response) => {
  try {
    const modules = await query<{
      id: string;
      title: string;
      order_index: number;
      html_content: string;
      version: number;
    }>(`
      SELECT m.id, m.title, m.order_index, c.html_content, c.version
      FROM cms_modules m
      LEFT JOIN cms_module_content c ON m.id = c.module_id AND c.status = 'published'
      WHERE m.is_active = true
      ORDER BY m.order_index
    `);

    res.json({
      modules: modules.map(m => ({
        id: m.id,
        title: m.title,
        orderIndex: m.order_index,
        htmlContent: m.html_content,
        version: m.version
      }))
    });
  } catch (error) {
    console.error('Get all modules error:', error);
    res.status(500).json({ error: 'Failed to get modules' });
  }
});

export default router;
