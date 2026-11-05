import pg from 'pg';

let pool = null;
let connected = false;

export async function initDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname;
    const isLocal = ['localhost', '127.0.0.1', '::1'].includes(hostname);
    // Render internal URLs (dpg-...-a) are plaintext within the private network;
    // external hosts (Neon, Supabase, *.render.com) require SSL.
    const ssl = isLocal || !hostname.includes('.') ? undefined : { rejectUnauthorized: false };
    pool = new pg.Pool({
      connectionString: url,
      max: 2,
      idleTimeoutMillis: 30000,
      ssl,
    });
    await pool.query(
      'CREATE TABLE IF NOT EXISTS app_state (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())',
    );
    connected = true;
    return true;
  } catch (error) {
    console.warn('[db] không kết nối được Postgres:', error.message);
    return false;
  }
}

export function isDbConnected() {
  return connected;
}

export async function loadSnapshot(key) {
  if (!connected) return null;
  try {
    const { rows } = await pool.query('SELECT value FROM app_state WHERE key = $1', [key]);
    return rows[0] ? rows[0].value : null;
  } catch {
    return null;
  }
}

export async function saveSnapshot(key, value) {
  if (!connected) return;
  try {
    await pool.query(
      'INSERT INTO app_state (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
      [key, JSON.stringify(value)],
    );
  } catch (error) {
    console.warn('[db] không ghi snapshot:', error.message);
  }
}
