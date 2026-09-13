/** Additive learning-workspace schema; existing training/certification rows are untouched. */
export const workspaceSchema = `
CREATE TABLE IF NOT EXISTS learning_practice (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_name TEXT NOT NULL,
  section_anchor TEXT NOT NULL,
  section_title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('needs_practice','ready')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, module_name, section_anchor)
);
CREATE TABLE IF NOT EXISTS coaching_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  manager_id UUID NOT NULL REFERENCES users(id),
  module_name TEXT NOT NULL,
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','reviewed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS coaching_assignments_user ON coaching_assignments(user_id, created_at DESC);
`;
