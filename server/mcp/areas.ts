/**
 * MCP areas — the units a personal agent token is scoped to.
 *
 * A scope is "<area>:<access>" (e.g. "progress:read"). Pass one is READ ONLY
 * by construction: only ":read" scopes can be minted, every tool is a read,
 * and the loopback session the tools act through carries agent_scope
 * 'mcp:read', which requireAuth refuses on any non-GET/HEAD request. Writes
 * come later.
 *
 * Who may mint which area: a person may only mint a scope for an area their
 * role already reaches in the app. Lite Training has exactly two roles — a
 * trainee (users.is_manager = false) and a manager (is_manager = true). Every
 * trainee-facing GET is requireAuth-only and scopes its rows INSIDE the route
 * (own progress, own exam attempts, own roleplay sessions; a manager may open
 * anyone's attempt or session), so five areas are open to both roles and the
 * route's own answer is the ceiling. The one exception carries a real gate:
 * `admin` mirrors requireManager on /api/admin/*.
 *
 * Super-admin (CMS) routes are NOT an area: they authenticate against the
 * separate `admin_sessions` table (server/middleware/superadmin.ts), which a
 * user session — and therefore a loopback session — can never satisfy.
 *
 * This module has no dependency on @omj21/mcp21 so the UI-facing route and
 * the unit tests can import it cheaply.
 */

export const MCP_AREAS = [
  'me',
  'progress',
  'exam',
  'roleplay',
  'content',
  'admin',
] as const;

export type McpArea = (typeof MCP_AREAS)[number];
export type McpAccess = 'read' | 'write';

/** The slice of a user row the gates need — Lite Training's whole role model. */
export type McpPrincipal = { isManager?: boolean | null };

const anyRole = (_user: McpPrincipal) => true;
const managerOnly = (user: McpPrincipal) => user.isManager === true;

/**
 * Per-area mint gate. Each names the route guard it mirrors. `anyRole` means
 * the routes behind the area are requireAuth-only (or public) and scope their
 * rows themselves.
 */
export const MCP_AREA_GATES: Record<McpArea, (user: McpPrincipal) => boolean> = {
  // GET /api/auth/me, /api/progress/badges — the person's own record
  me: anyRole,
  // GET /api/progress (own), /api/progress/leaderboard, /api/progress/review (own)
  progress: anyRole,
  // GET /api/exam/history (own), /api/exam/answers/:attemptId (own, or any for a manager — the route checks)
  exam: anyRole,
  // GET /api/roleplay/history (own), /api/roleplay/session/:sessionId (own, or any for a manager — the route checks)
  roleplay: anyRole,
  // GET /api/content/modules, /api/content/modules/:id — public routes (no auth at all)
  content: anyRole,
  // GET /api/admin/* → router.use(requireManager)
  admin: managerOnly,
};

/** Human labels for the Connected agents panel. */
export const MCP_AREA_LABELS: Record<McpArea, { label: string; description: string }> = {
  me: { label: 'Me', description: 'Your own profile: name, certification, XP, streak, modules completed and achievements' },
  progress: { label: 'Progress', description: 'Your module progress, exam summary, leaderboards and review cards due' },
  exam: { label: 'Exam', description: 'Your final-exam attempts and the answers on each attempt' },
  roleplay: { label: 'Roleplay', description: 'Your Agnes roleplay sessions and their score breakdowns' },
  content: { label: 'Content', description: 'The published training modules and their content' },
  admin: { label: 'Admin', description: 'The trainee roster, per-trainee detail, analytics and the progress grid (managers)' },
};

export function isMcpArea(value: unknown): value is McpArea {
  return typeof value === 'string' && (MCP_AREAS as readonly string[]).includes(value);
}

/** True when this person may mint a scope for the area (see the header). */
export function userCanMintArea(user: McpPrincipal | null | undefined, area: McpArea): boolean {
  if (!user) return false;
  return MCP_AREA_GATES[area](user);
}

/** The areas a person may mint, in canonical order. */
export function mintableAreasForUser(user: McpPrincipal | null | undefined): McpArea[] {
  return MCP_AREAS.filter((area) => userCanMintArea(user, area));
}

/** `ok` with the accepted scopes, or `ok: false` with one plain sentence in `error`. */
export type ScopeValidation = { ok: boolean; scopes: string[]; error?: string };

/**
 * Validate the scopes a person asks for at mint time. Pass one: ":read" only.
 * Returns one plain sentence on refusal, naming what was refused.
 */
export function validateRequestedScopes(user: McpPrincipal | null | undefined, requested: unknown): ScopeValidation {
  if (!Array.isArray(requested) || requested.length === 0) {
    return { ok: false, scopes: [], error: 'Pick at least one scope, such as "progress:read".' };
  }
  if (requested.length > 50) {
    return { ok: false, scopes: [], error: 'Too many scopes in one token.' };
  }
  const accepted: string[] = [];
  const writes: string[] = [];
  const outsideRole: string[] = [];
  const malformed: string[] = [];
  for (const raw of requested) {
    if (typeof raw !== 'string') { malformed.push(String(raw)); continue; }
    const parts = raw.trim().split(':');
    if (parts.length !== 2) { malformed.push(raw); continue; }
    const [area, access] = parts;
    if (!isMcpArea(area)) { malformed.push(raw); continue; }
    if (access === 'write') { writes.push(area); continue; }
    if (access !== 'read') { malformed.push(raw); continue; }
    if (!userCanMintArea(user, area)) { outsideRole.push(area); continue; }
    if (!accepted.includes(`${area}:read`)) accepted.push(`${area}:read`);
  }
  if (writes.length > 0) {
    return { ok: false, scopes: [], error: `Writes are not enabled yet; agent tokens can only read (${uniq(writes).join(', ')}).` };
  }
  if (outsideRole.length > 0) {
    return { ok: false, scopes: [], error: `Your role does not have access to: ${uniq(outsideRole).join(', ')}.` };
  }
  if (malformed.length > 0) {
    return { ok: false, scopes: [], error: `Unknown scope: ${uniq(malformed).join(', ')}. Use "<area>:read" with an area from ${MCP_AREAS.join(', ')}.` };
  }
  return { ok: true, scopes: accepted };
}

function uniq(items: string[]): string[] {
  return Array.from(new Set(items));
}
