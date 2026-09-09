-- Roof E.R. Lite Training - Database Schema
-- PostgreSQL

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    is_manager BOOLEAN DEFAULT FALSE,
    registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    commitment_signed BOOLEAN DEFAULT FALSE,
    commitment_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sessions for authentication
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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

-- Module progress tracking
CREATE TABLE IF NOT EXISTS module_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    module_name VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'locked',
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    time_spent_seconds INTEGER DEFAULT 0,
    last_accessed TIMESTAMP,
    UNIQUE(user_id, module_name)
);

-- Exam attempts with full details
CREATE TABLE IF NOT EXISTS exam_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    mcq_correct INTEGER,
    fib_correct INTEGER,
    sa_points DECIMAL(4,2),
    total_score INTEGER,
    passed BOOLEAN,
    time_taken_seconds INTEGER
);

-- Individual exam answers (for detailed tracking)
CREATE TABLE IF NOT EXISTS exam_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID REFERENCES exam_attempts(id) ON DELETE CASCADE,
    question_type VARCHAR(10),
    question_id VARCHAR(20),
    question_number INTEGER,
    question_text TEXT,
    user_answer TEXT,
    correct_answer TEXT,
    is_correct BOOLEAN,
    points_earned DECIMAL(4,2)
);

-- Agnes roleplay sessions
CREATE TABLE IF NOT EXISTS roleplay_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    module_context VARCHAR(50),
    difficulty VARCHAR(20),
    personality VARCHAR(50),
    training_type VARCHAR(20),
    input_mode VARCHAR(10),
    final_score INTEGER,
    xp_earned INTEGER,
    door_slammed BOOLEAN DEFAULT FALSE,
    session_duration_seconds INTEGER
);

-- Roleplay scoring breakdown
CREATE TABLE IF NOT EXISTS roleplay_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES roleplay_sessions(id) ON DELETE CASCADE,
    category VARCHAR(50),
    points_earned INTEGER,
    max_points INTEGER,
    feedback TEXT
);

-- Certification records
CREATE TABLE IF NOT EXISTS certifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    certified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    passing_attempt_id UUID REFERENCES exam_attempts(id),
    certificate_name VARCHAR(255),
    score INTEGER
);

-- XP and gamification data
CREATE TABLE IF NOT EXISTS user_gamification (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    total_xp INTEGER DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_activity_date DATE,
    unlocked_difficulties TEXT[] DEFAULT '{}'
);

-- Activity log for tracking quiz/game/practice/challenge/roleplay completions
CREATE TABLE IF NOT EXISTS activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    module_name VARCHAR(50) NOT NULL,
    activity_type VARCHAR(20) NOT NULL,
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, module_name, activity_type)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_name ON users(name);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_module_progress_user ON module_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_user ON exam_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_exam_answers_attempt ON exam_answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_roleplay_sessions_user ON roleplay_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_login_history_user ON login_history(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);

-- ============================================
-- MCP: personal agent tokens (reads first, 2026-09-08)
-- ============================================
-- Documentation copy. The app applies this itself at boot: the inline
-- `migrations` block in server/db/connection.ts (initDatabase) runs on every
-- start and is idempotent, so a deploy is the migration. Keep both in step.
--
-- sessions.agent_scope is the ceiling. NULL = a normal login session.
-- 'mcp:read' = a loopback session (server/mcp/loopback.ts) that requireAuth
-- refuses on any non-GET/HEAD request (server/middleware/auth.ts).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS agent_scope TEXT;

-- Personal agent tokens: sha256 of the token, never the token.
CREATE TABLE IF NOT EXISTS mcp_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    token_hint TEXT NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT '{}',
    expires_at TIMESTAMP,
    last_used_at TIMESTAMP,
    revoked_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user ON mcp_tokens(user_id, created_at DESC);

-- One row per tools/call: argument KEYS only, never values. No FK on purpose.
CREATE TABLE IF NOT EXISTS mcp_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    token_id UUID NOT NULL,
    request_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    area TEXT NOT NULL,
    access TEXT NOT NULL CHECK (access IN ('read', 'write')),
    argument_keys TEXT[] NOT NULL DEFAULT '{}',
    ok BOOLEAN NOT NULL,
    error TEXT,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_log_token ON mcp_audit_log(token_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_log_user ON mcp_audit_log(user_id, created_at DESC);
