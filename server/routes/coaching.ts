import { Router } from 'express';
import { query, queryOne, isDatabaseAvailable } from '../db/connection.js';
import { requireAuth, requireManager } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.use((_req,res,next) => { if (!isDatabaseAvailable()) {res.status(503).json({error:'Coaching needs an online connection.'}); return;} next(); });
const modules = new Set(['welcome','general-knowledge','shingle-types-materials','initial-pitch','handling-initial-pitch-objections','damage-identification','inspection-process','post-inspection-pitch','post-inspection-objections','filing-claim-closing','sales-cycle-job-flow','role-play']);
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

router.post('/practice', async (req,res) => {
  const {module, section, anchor, status} = req.body;
  if (!modules.has(module) || typeof section !== 'string' || !section.trim() || section.length > 300 || typeof anchor !== 'string' || !/^[\w-]{1,100}$/.test(anchor) || !['needs_practice','ready'].includes(status)) { res.status(400).json({error:'Invalid practice record.'}); return; }
  try {
    await query(`INSERT INTO learning_practice (user_id,module_name,section_anchor,section_title,status) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (user_id,module_name,section_anchor) DO UPDATE SET section_title=$4,status=$5,updated_at=NOW()`, [req.user!.id,module,anchor,section,status]);
    res.json({success:true});
  } catch { res.status(500).json({error:'Practice could not sync. Your local review is still available.'}); }
});

router.get('/mine', async (req,res) => {
  try {
    const assignments = await query(`SELECT a.id,a.module_name,a.note,a.status,a.created_at,a.reviewed_at,u.name AS manager_name FROM coaching_assignments a JOIN users u ON u.id=a.manager_id WHERE a.user_id=$1 ORDER BY a.created_at DESC`, [req.user!.id]);
    const practice = await query(`SELECT module_name,section_anchor,section_title,status,updated_at FROM learning_practice WHERE user_id=$1 ORDER BY updated_at DESC`,[req.user!.id]);
    res.json({assignments,practice});
  } catch {res.status(500).json({error:'Coaching could not load.'});}
});

router.get('/users/:id', requireManager, async (req,res) => {
  if (!uuid.test(req.params.id)) {res.status(400).json({error:'Invalid rep.'}); return;}
  try {
    const practice = await query(`SELECT module_name,section_title,section_anchor,status,updated_at FROM learning_practice WHERE user_id=$1 ORDER BY updated_at DESC`,[req.params.id]);
    const assignments = await query(`SELECT id,module_name,note,status,created_at,reviewed_at FROM coaching_assignments WHERE user_id=$1 ORDER BY created_at DESC`,[req.params.id]);
    res.json({practice,assignments});
  } catch {res.status(500).json({error:'Coaching could not load.'});}
});

router.post('/assignments', requireManager, async (req,res) => {
  const {userId,module,note} = req.body;
  if (typeof userId !== 'string' || !uuid.test(userId) || !modules.has(module) || typeof note !== 'string' || !note.trim() || note.length > 3000) {res.status(400).json({error:'Choose a rep, lesson, and coaching note (up to 3000 characters).'}); return;}
  try {
    if (!await queryOne('SELECT id FROM users WHERE id=$1',[userId])) {res.status(404).json({error:'Rep not found.'}); return;}
    const assignment = await queryOne(`INSERT INTO coaching_assignments (user_id,manager_id,module_name,note) VALUES ($1,$2,$3,$4) RETURNING id`,[userId,req.user!.id,module,note.trim()]);
    res.status(201).json({success:true,assignment});
  } catch {res.status(500).json({error:'Assignment was not saved. Try again.'});}
});

router.post('/assignments/:id/review', async (req,res) => {
  if (!uuid.test(req.params.id)) {res.status(400).json({error:'Invalid assignment.'}); return;}
  try {
    const row = await queryOne(`UPDATE coaching_assignments SET status='reviewed',reviewed_at=COALESCE(reviewed_at,NOW()) WHERE id=$1 AND user_id=$2 RETURNING id`,[req.params.id,req.user!.id]);
    if (!row) {res.status(404).json({error:'Assignment not found.'}); return;}
    res.json({success:true});
  } catch {res.status(500).json({error:'Review could not be saved.'});}
});
export default router;
