import pg from 'pg';
const { Pool } = pg;

// Database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test connection on startup
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

// Query helper with error handling
export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
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
      // Read and execute schema file
      const fs = await import('fs');
      const path = await import('path');
      const schemaPath = path.join(process.cwd(), 'server', 'db', 'schema.sql');

      if (fs.existsSync(schemaPath)) {
        const schema = fs.readFileSync(schemaPath, 'utf8');
        await pool.query(schema);
        console.log('Database schema initialized successfully');
      } else {
        console.warn('Schema file not found, skipping initialization');
      }
    } else {
      console.log('Database schema already exists');
    }
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

export { pool };
export default pool;
