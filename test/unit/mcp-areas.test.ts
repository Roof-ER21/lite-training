/**
 * MCP pass one — the area list, the tool registry behind it, and the scope
 * validation a person meets when minting a token.
 *
 * No server, no database query: the tool registry opens no pool and the
 * loopback helper imports its db lazily.
 */
import { describe, expect, it } from 'vitest';
import { assertAreasCovered, parseScopes } from '@omj21/mcp21';
import {
  MCP_AREAS,
  MCP_AREA_LABELS,
  mintableAreasForUser,
  userCanMintArea,
  validateRequestedScopes,
} from '../../server/mcp/areas.js';
import { MCP_TOOLS } from '../../server/mcp/tools.js';

const manager = { isManager: true };
const trainee = { isManager: false };

describe('MCP areas × tools', () => {
  it('every area has at least one read tool behind it', () => {
    expect(assertAreasCovered(MCP_AREAS, MCP_TOOLS).missing).toEqual([]);
  });

  it('every tool is a read in a known area, with a unique snake_case name and a description', () => {
    const names = new Set<string>();
    for (const tool of MCP_TOOLS) {
      expect(tool.access).toBe('read');
      expect(MCP_AREAS as readonly string[]).toContain(tool.area);
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(names.has(tool.name)).toBe(false);
      names.add(tool.name);
      expect(tool.description.length).toBeGreaterThan(30);
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('every area has a label', () => {
    for (const area of MCP_AREAS) {
      expect(MCP_AREA_LABELS[area].label.length).toBeGreaterThan(0);
      expect(MCP_AREA_LABELS[area].description.length).toBeGreaterThan(0);
    }
  });

  it('the scope strings we mint are ones the kit parses', () => {
    const scopes = MCP_AREAS.map((a) => `${a}:read`);
    expect(parseScopes(scopes).map((s) => s.area)).toEqual([...MCP_AREAS]);
  });

  it('only the admin area carries tools that need a manager', () => {
    const adminTools = MCP_TOOLS.filter((t) => t.area === 'admin').map((t) => t.name);
    expect(adminTools.length).toBeGreaterThan(0);
    for (const name of adminTools) expect(name).toMatch(/^admin_/);
    for (const t of MCP_TOOLS) if (t.name.startsWith('admin_')) expect(t.area).toBe('admin');
  });
});

describe('who may mint which area', () => {
  it('a manager may mint every area', () => {
    expect(mintableAreasForUser(manager)).toEqual([...MCP_AREAS]);
  });

  it('a trainee may mint everything but admin (requireManager on /api/admin/*)', () => {
    const areas = mintableAreasForUser(trainee);
    expect(areas).toEqual(['me', 'progress', 'exam', 'roleplay', 'content']);
    expect(userCanMintArea(trainee, 'admin')).toBe(false);
    expect(userCanMintArea(manager, 'admin')).toBe(true);
  });

  it('no person mints nothing; an undefined flag is a trainee', () => {
    expect(mintableAreasForUser(null)).toEqual([]);
    expect(mintableAreasForUser(undefined)).toEqual([]);
    expect(mintableAreasForUser({})).toEqual(['me', 'progress', 'exam', 'roleplay', 'content']);
    expect(userCanMintArea({ isManager: null }, 'admin')).toBe(false);
  });
});

describe('validateRequestedScopes (mint time)', () => {
  it('accepts read scopes the role holds, de-duplicated', () => {
    const r = validateRequestedScopes(manager, ['progress:read', 'admin:read', 'progress:read']);
    expect(r).toEqual({ ok: true, scopes: ['progress:read', 'admin:read'] });
  });

  it('refuses a write scope with a plain sentence — writes are not enabled yet', () => {
    const r = validateRequestedScopes(manager, ['progress:read', 'progress:write']);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not enabled yet/i);
    expect(r.error).toContain('progress');
  });

  it('refuses an area outside the role, naming the area', () => {
    const r = validateRequestedScopes(trainee, ['me:read', 'admin:read']);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/does not have access to: admin/);
  });

  it('refuses malformed and unknown scopes', () => {
    for (const bad of [['cms:read'], ['progress'], ['progress:read:extra'], [42], ['*:read']]) {
      const r = validateRequestedScopes(manager, bad);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/Unknown scope/);
    }
  });

  it('refuses an empty or non-array request', () => {
    expect(validateRequestedScopes(manager, []).ok).toBe(false);
    expect(validateRequestedScopes(manager, 'progress:read').ok).toBe(false);
    expect(validateRequestedScopes(manager, undefined).ok).toBe(false);
  });
});
