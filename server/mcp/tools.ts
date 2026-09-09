/**
 * MCP tools — pass one, reads only.
 *
 * Every tool wraps ONE of Lite Training's own GET routes over loopback (see
 * loopback.ts). The comment on each names the route file and handler it wraps
 * and the query params that route actually reads; nothing else is forwarded.
 * What a tool returns is always the route's own answer for this person.
 * Descriptions are written for a model to act on.
 *
 * Not wrapped, on purpose: /api/cms/* and /api/admin-auth/* (super-admin
 * sessions, a different table a user session cannot satisfy), /api/ai/status
 * (server configuration, not the person's data), /api/gemini/* (POST proxy).
 */

import type { Mcp21Tool } from '@omj21/mcp21';
import { loopbackGet, segment } from './loopback.js';
import type { McpArea } from './areas.js';

type Args = Record<string, unknown>;
type Props = Record<string, unknown>;

const STRING = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra });
const ENUM = (description: string, values: string[]) => ({ type: 'string', description, enum: values });
const ID = (what: string) => STRING(`The ${what} id as it appears in Lite Training.`, { minLength: 1, maxLength: 128 });

const badId = (what: string) => ({ isError: true, text: `The ${what} id is not a valid id.` });

/** A read tool over a fixed path with an optional query whitelist. */
function get(
  name: string,
  area: McpArea,
  description: string,
  path: string,
  properties: Props = {},
  query: readonly string[] = [],
  pick?: (json: unknown) => unknown,
): Mcp21Tool<Args> {
  return {
    name, area, description, access: 'read',
    inputSchema: { type: 'object', properties },
    run: (ctx, args) => loopbackGet(ctx, { path, args, query, pick }),
  };
}

/** A read tool whose path takes ONE id argument (`idArg`). */
function getById(
  name: string,
  area: McpArea,
  description: string,
  idArg: string,
  what: string,
  pathFor: (id: string) => string,
): Mcp21Tool<Args> {
  return {
    name, area, description, access: 'read',
    inputSchema: {
      type: 'object',
      properties: { [idArg]: ID(what) },
      required: [idArg],
    },
    run: (ctx, args) => {
      const id = segment(args[idArg]);
      if (!id) return Promise.resolve(badId(what));
      return loopbackGet(ctx, { path: pathFor(id), args });
    },
  };
}

/** The module list without each module's full HTML — `content_module` fetches one. */
function stripModuleHtml(json: unknown): unknown {
  const body = json as { modules?: Array<Record<string, unknown>> } | null;
  if (!body || !Array.isArray(body.modules)) return json;
  return {
    modules: body.modules.map(({ htmlContent, ...rest }) => ({
      ...rest,
      hasPublishedContent: typeof htmlContent === 'string' && htmlContent.length > 0,
    })),
  };
}

export const MCP_TOOLS: readonly Mcp21Tool<Args>[] = [
  // ── me ──────────────────────────────────────────────────────────────────
  // server/routes/auth.ts → router.get('/me') (mounted at /api/auth) — requireAuth, no params
  get('me', 'me',
    'Who this token acts as: id, name, whether they are a manager, registration date, commitment status, ' +
    'modules completed, certification (date and score), total XP and current streak. ' +
    'Call this first to learn the person\'s own user id for other tools.',
    '/api/auth/me'),
  // server/routes/progress.ts → router.get('/badges') (mounted at /api/progress) — requireAuth, no params
  get('my_badges', 'me',
    'This person\'s achievements: the badges they have earned (with the date) and every badge available, each flagged earned or not.',
    '/api/progress/badges'),

  // ── progress ────────────────────────────────────────────────────────────
  // server/routes/progress.ts → router.get('/') (mounted at /api/progress) — requireAuth, no params
  get('my_progress', 'progress',
    'This person\'s full training progress: each module with status (locked, unlocked, in_progress, completed), ' +
    'start/completion times and time spent; every exam attempt with scores; certification; commitment; XP, streaks ' +
    'and unlocked roleplay difficulties.',
    '/api/progress'),
  // server/routes/progress.ts → router.get('/leaderboard') — requireAuth
  // reads: type (weekly | alltime | streaks | exams; default weekly)
  get('leaderboard', 'progress',
    'The company leaderboard (top 25) and this person\'s rank on it. type = weekly (XP, active in the last 7 days), ' +
    'alltime (XP), streaks (longest streak) or exams (best passing exam score). Omit for weekly.',
    '/api/progress/leaderboard',
    { type: ENUM('Which board: weekly, alltime, streaks or exams. Omit for weekly.', ['weekly', 'alltime', 'streaks', 'exams']) },
    ['type']),
  // server/routes/progress.ts → router.get('/review') — requireAuth, no params
  get('my_review_due', 'progress',
    'This person\'s spaced-repetition review: up to 20 cards due now (question, correct answer, interval, repetitions) ' +
    'plus how many are due and how many exist in total.',
    '/api/progress/review'),

  // ── exam ────────────────────────────────────────────────────────────────
  // server/routes/exam.ts → router.get('/history') (mounted at /api/exam) — requireAuth, no params
  get('my_exam_history', 'exam',
    'This person\'s final-exam attempts in order: attempt number, date, multiple-choice / fill-in / short-answer scores, ' +
    'total score, pass/fail and time taken; plus certification status. Use an attempt id with exam_attempt_answers.',
    '/api/exam/history'),
  // server/routes/exam.ts → router.get('/answers/:attemptId') — own attempt, or any attempt for a manager (the route checks)
  getById('exam_attempt_answers', 'exam',
    'Every answer on one exam attempt: question type and number, the question, the answer given, the correct answer, ' +
    'whether it was right and points earned. Own attempts only, unless this person is a manager.',
    'attemptId', 'exam attempt', (id) => `/api/exam/answers/${id}`),

  // ── roleplay ────────────────────────────────────────────────────────────
  // server/routes/roleplay.ts → router.get('/history') (mounted at /api/roleplay) — requireAuth, no params
  get('my_roleplay_history', 'roleplay',
    'This person\'s last 50 Agnes roleplay sessions, newest first: personality, difficulty, input mode, final score, ' +
    'XP earned and whether the door was slammed. Use a session id with roleplay_session.',
    '/api/roleplay/history'),
  // server/routes/roleplay.ts → router.get('/session/:sessionId') — own session, or any session for a manager (the route checks)
  getById('roleplay_session', 'roleplay',
    'One roleplay session in full: the session record and its score breakdown by category with the reason for each. ' +
    'Own sessions only, unless this person is a manager.',
    'sessionId', 'roleplay session', (id) => `/api/roleplay/session/${id}`),

  // ── content ─────────────────────────────────────────────────────────────
  // server/routes/content.ts → router.get('/modules') (mounted at /api/content) — public, no params.
  // The route returns each module's published HTML too; this tool drops it (content_module fetches one).
  get('content_modules', 'content',
    'The active training modules in order: id, title, order and whether published content exists. ' +
    'Use the id with content_module to read one.',
    '/api/content/modules', {}, [], stripModuleHtml),
  // server/routes/content.ts → router.get('/modules/:id') — public
  getById('content_module', 'content',
    'The latest published content of one training module as HTML, with its version and publish date.',
    'moduleId', 'module', (id) => `/api/content/modules/${id}`),

  // ── admin (managers) ────────────────────────────────────────────────────
  // server/routes/admin.ts → router.get('/users') (mounted at /api/admin) — requireAuth + requireManager, no params
  get('admin_users', 'admin',
    'Every trainee and manager with summary stats: registration, last login, commitment, modules completed, ' +
    'exam attempts, certified flag and total XP. Managers only.',
    '/api/admin/users'),
  // server/routes/admin.ts → router.get('/users/:id') — requireManager
  getById('admin_user', 'admin',
    'One person in detail: profile, per-module progress, exam attempts, roleplay sessions, certification and gamification. Managers only.',
    'userId', 'user', (id) => `/api/admin/users/${id}`),
  // server/routes/admin.ts → router.get('/analytics') — requireManager, no params
  get('admin_analytics', 'admin',
    'Company-wide training analytics: user counts (total, new this week, active), certifications, exam pass rates, ' +
    'module completion and roleplay totals. Managers only.',
    '/api/admin/analytics'),
  // server/routes/admin.ts → router.get('/module-analytics') — requireManager, no params
  get('admin_module_analytics', 'admin',
    'Per-module analytics across all trainees: how many started and completed each module and time spent. Managers only.',
    '/api/admin/module-analytics'),
  // server/routes/admin.ts → router.get('/progress-grid') — requireManager
  // reads: search (case-insensitive substring of the trainee name)
  get('admin_progress_grid', 'admin',
    'The progress grid: every trainee (non-manager) against every module with the status of each. ' +
    'search narrows to names containing the text. Managers only.',
    '/api/admin/progress-grid',
    { search: STRING('Only trainees whose name contains this text (case-insensitive).', { maxLength: 100 }) },
    ['search']),
  // server/routes/admin.ts → router.get('/users/:userId/exam/:attemptId/answers') — requireManager
  {
    name: 'admin_exam_attempt_answers',
    area: 'admin',
    access: 'read',
    description: 'One trainee\'s exam attempt with every answer, for review: scores, pass/fail, time taken and each question ' +
      'with the answer given and the correct answer. Managers only.',
    inputSchema: {
      type: 'object',
      properties: { userId: ID('user'), attemptId: ID('exam attempt') },
      required: ['userId', 'attemptId'],
    },
    run: (ctx, args) => {
      const userId = segment(args.userId);
      if (!userId) return Promise.resolve(badId('user'));
      const attemptId = segment(args.attemptId);
      if (!attemptId) return Promise.resolve(badId('exam attempt'));
      return loopbackGet(ctx, { path: `/api/admin/users/${userId}/exam/${attemptId}/answers`, args });
    },
  },
];
