import { Router, Request, Response } from 'express';
import { query } from '../db/connection.js';
import { requireAuth } from '../middleware/auth.js';

/** Read existing earned credentials only; these routes never award certification. */
async function records(userId?: string) {
  const rows = await query<{ id: string; user_id: string; recipient_name: string; score: number; certified_at: Date }>(`
    SELECT c.id, c.user_id, COALESCE(NULLIF(TRIM(c.certificate_name), ''), u.name) AS recipient_name,
      c.score, c.certified_at
    FROM certifications c JOIN users u ON u.id = c.user_id
    ${userId ? 'WHERE c.user_id = $1' : ''}
    ORDER BY c.certified_at DESC, c.id
  `, userId ? [userId] : []);
  return rows.map(row => ({
    userId: row.user_id,
    recipientName: row.recipient_name,
    score: row.score,
    certificationDate: new Date(row.certified_at).toISOString(),
    certificateId: `RER-${new Date(row.certified_at).getUTCFullYear()}-${row.id.replace(/-/g, '').slice(0, 12).toUpperCase()}`,
  }));
}

async function sendRecord(userId: string, res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  const certificate = (await records(userId))[0];
  if (!certificate) return res.status(404).json({ error: 'No earned certificate is recorded for this representative.' });
  return res.json({ certificate });
}

export const certificateRoutes = Router();
certificateRoutes.use(requireAuth);
certificateRoutes.get('/me', async (req: Request, res: Response) => {
  try { await sendRecord(req.user!.id, res); }
  catch { res.status(503).json({ error: 'Certificate records are unavailable. Please try again.' }); }
});

/** Mount only behind the manager or super-admin middleware of the parent router. */
export function privilegedCertificateRoutes() {
  const router = Router();
  router.get('/', async (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json({ certificates: await records() }); }
    catch { res.status(503).json({ error: 'Certificate records are unavailable. Please try again.' }); }
  });
  router.get('/:userId', async (req: Request, res: Response) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid representative ID.' });
    }
    try { await sendRecord(req.params.userId, res); }
    catch { res.status(503).json({ error: 'Certificate records are unavailable. Please try again.' }); }
  });
  return router;
}
