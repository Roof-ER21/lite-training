/** Additive migration: unfinished work is independent of graded answers. */
export const examDraftSchema = `
ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS draft JSONB;
ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS draft_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS draft_saved_at TIMESTAMPTZ;
`;
