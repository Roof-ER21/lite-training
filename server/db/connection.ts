import pg from 'pg';
const { Pool } = pg;

// Check if database is configured
const databaseUrl = process.env.DATABASE_URL;
let pool: pg.Pool | null = null;
let dbAvailable = false;

if (databaseUrl) {
  console.log('DATABASE_URL is configured, connecting to PostgreSQL...');
  pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false } // Railway requires SSL
  });

  // Test connection on startup
  pool.on('connect', () => {
    console.log('Connected to PostgreSQL database');
    dbAvailable = true;
  });

  pool.on('error', (err) => {
    console.error('Unexpected database error:', err);
    dbAvailable = false;
  });
} else {
  console.warn('DATABASE_URL not set - running without database (localStorage fallback mode)');
}

// Check if database is available
export function isDatabaseAvailable(): boolean {
  return dbAvailable && pool !== null;
}

// Query helper with error handling
export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  if (!pool) {
    console.warn('Database not configured, skipping query');
    return [];
  }

  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'production') {
      console.log('Query executed:', { text: text.substring(0, 50), duration, rows: result.rowCount });
    }
    return result.rows as T[];
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

// Get a single row
export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

// Initialize database schema
export async function initDatabase(): Promise<void> {
  if (!pool) {
    console.log('No database configured, skipping schema initialization');
    return;
  }

  try {
    // Check if users table exists
    const tableCheck = await query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'users'
      );
    `);

    if (!tableCheck[0]?.exists) {
      console.log('Initializing database schema...');
      // Execute schema inline since file path is tricky in production
      const schema = `
        -- Users table
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(255) NOT NULL UNIQUE,
          is_manager BOOLEAN DEFAULT FALSE,
          registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_login TIMESTAMP,
          commitment_signed BOOLEAN DEFAULT FALSE,
          commitment_date TIMESTAMP
        );

        -- Sessions table
        CREATE TABLE IF NOT EXISTS sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          token VARCHAR(255) UNIQUE NOT NULL,
          expires_at TIMESTAMP,
          is_active BOOLEAN DEFAULT TRUE
        );

        -- Login history
        CREATE TABLE IF NOT EXISTS login_history (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          ip_address VARCHAR(45),
          user_agent TEXT
        );

        -- User gamification (XP, streaks, etc.)
        CREATE TABLE IF NOT EXISTS user_gamification (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
          total_xp INTEGER DEFAULT 0,
          current_streak INTEGER DEFAULT 0,
          longest_streak INTEGER DEFAULT 0,
          last_activity_date DATE
        );

        -- Module progress
        CREATE TABLE IF NOT EXISTS module_progress (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          module_name VARCHAR(50) NOT NULL,
          status VARCHAR(20) DEFAULT 'locked',
          started_at TIMESTAMP,
          completed_at TIMESTAMP,
          time_spent_seconds INTEGER DEFAULT 0,
          UNIQUE(user_id, module_name)
        );

        -- Exam attempts
        CREATE TABLE IF NOT EXISTS exam_attempts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          attempt_number INTEGER,
          completed_at TIMESTAMP,
          mcq_score INTEGER,
          fib_score INTEGER,
          sa_score INTEGER,
          total_score INTEGER,
          passed BOOLEAN,
          time_taken_seconds INTEGER
        );

        -- Exam answers
        CREATE TABLE IF NOT EXISTS exam_answers (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          attempt_id UUID REFERENCES exam_attempts(id) ON DELETE CASCADE,
          question_type VARCHAR(10),
          question_id VARCHAR(20),
          user_answer TEXT,
          correct_answer TEXT,
          is_correct BOOLEAN
        );

        -- Roleplay sessions
        CREATE TABLE IF NOT EXISTS roleplay_sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP,
          personality VARCHAR(50),
          difficulty VARCHAR(20),
          input_mode VARCHAR(10),
          final_score INTEGER,
          xp_earned INTEGER,
          door_slammed BOOLEAN DEFAULT FALSE
        );

        -- Certifications
        CREATE TABLE IF NOT EXISTS certifications (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          certified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          score INTEGER
        );

        -- Create indexes for common queries
        CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_module_progress_user ON module_progress(user_id);
        CREATE INDEX IF NOT EXISTS idx_exam_attempts_user ON exam_attempts(user_id);
        CREATE INDEX IF NOT EXISTS idx_roleplay_sessions_user ON roleplay_sessions(user_id);
      `;

      await pool.query(schema);
      console.log('Database schema initialized successfully');
    } else {
      console.log('Database schema already exists, running migrations...');
    }

    // Always run migrations to add missing tables/columns
    const migrations = `
      -- Add missing columns to users table
      ALTER TABLE users ADD COLUMN IF NOT EXISTS commitment_date TIMESTAMP;

      -- Add missing columns to login_history table
      ALTER TABLE login_history ADD COLUMN IF NOT EXISTS user_agent TEXT;

      -- Create user_gamification table if not exists
      CREATE TABLE IF NOT EXISTS user_gamification (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        total_xp INTEGER DEFAULT 0,
        current_streak INTEGER DEFAULT 0,
        longest_streak INTEGER DEFAULT 0,
        last_activity_date DATE
      );

      -- Ensure all other tables exist
      CREATE TABLE IF NOT EXISTS roleplay_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        personality VARCHAR(50),
        difficulty VARCHAR(20),
        input_mode VARCHAR(10),
        final_score INTEGER,
        xp_earned INTEGER,
        door_slammed BOOLEAN DEFAULT FALSE
      );

      CREATE TABLE IF NOT EXISTS certifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        certified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        score INTEGER
      );

      -- Add missing columns to module_progress table
      ALTER TABLE module_progress ADD COLUMN IF NOT EXISTS last_accessed TIMESTAMP;

      -- Add missing columns to user_gamification table
      ALTER TABLE user_gamification ADD COLUMN IF NOT EXISTS unlocked_difficulties TEXT[] DEFAULT ARRAY['easy'];

      -- Add missing columns to exam_attempts table
      ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS started_at TIMESTAMP;
      ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS mcq_correct INTEGER DEFAULT 0;
      ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS fib_correct INTEGER DEFAULT 0;
      ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS sa_points INTEGER DEFAULT 0;

      -- Ensure exam_answers table has all required columns
      ALTER TABLE exam_answers ADD COLUMN IF NOT EXISTS question_number INTEGER;
      ALTER TABLE exam_answers ADD COLUMN IF NOT EXISTS question_text TEXT;
      ALTER TABLE exam_answers ADD COLUMN IF NOT EXISTS points_earned INTEGER DEFAULT 0;

      -- Create roleplay_scores table if not exists (referenced in reset-progress)
      CREATE TABLE IF NOT EXISTS roleplay_scores (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID REFERENCES roleplay_sessions(id) ON DELETE CASCADE,
        category VARCHAR(50),
        score INTEGER,
        feedback TEXT
      );

      -- User badges table for achievement system
      CREATE TABLE IF NOT EXISTS user_badges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        badge_id VARCHAR(50) NOT NULL,
        earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, badge_id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id);

      -- Spaced repetition review cards
      CREATE TABLE IF NOT EXISTS review_cards (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        question_type VARCHAR(20) NOT NULL,
        question_id VARCHAR(100) NOT NULL,
        question_text TEXT,
        correct_answer TEXT,
        ease_factor DECIMAL DEFAULT 2.5,
        interval_days INTEGER DEFAULT 1,
        repetitions INTEGER DEFAULT 0,
        next_review_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_quality INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, question_type, question_id)
      );
      CREATE INDEX IF NOT EXISTS idx_review_cards_user ON review_cards(user_id);
      CREATE INDEX IF NOT EXISTS idx_review_cards_next_review ON review_cards(next_review_at);

      -- Push notification subscriptions for PWA
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, endpoint)
      );
    `;

    await pool.query(migrations);
    console.log('Database migrations completed');

    dbAvailable = true;
  } catch (error) {
    console.error('Error initializing database:', error);
    // Don't throw - allow server to start without database
    dbAvailable = false;
  }
}

export { pool };
export default pool;
