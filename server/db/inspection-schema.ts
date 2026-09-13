/** Routes historically referenced these columns, but bootstrap schemas omitted them.
 * Add compatible columns without changing or resetting historical records.
 */
export const inspectionSchema = `
ALTER TABLE roleplay_sessions ADD COLUMN IF NOT EXISTS conversation_log TEXT;
ALTER TABLE roleplay_scores ADD COLUMN IF NOT EXISTS points NUMERIC(8,2);
ALTER TABLE roleplay_scores ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE roleplay_scores ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ DEFAULT NOW();
`;
