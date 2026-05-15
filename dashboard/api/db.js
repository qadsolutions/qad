import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     parseInt(process.env.PGPORT || '5433'),
  database: process.env.PGDATABASE || 'qad',
  user:     process.env.PGUSER     || 'qad_user',
  password: process.env.PGPASSWORD || 'changeme',
  max: 10,
  idleTimeoutMillis: 30000,
});

export async function query(sql, params) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}
