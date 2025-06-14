const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function verify() {
  try {
    // Check tables exist
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    `);
    console.log('✅ Tables:', tables.rows.map(r => r.table_name));

    // Check view exists
    const views = await pool.query(`
      SELECT table_name 
      FROM information_schema.views 
      WHERE table_schema = 'public'
    `);
    console.log('✅ Views:', views.rows.map(r => r.table_name));

    // Test active_tokens
    const tokens = await pool.query('SELECT * FROM active_tokens LIMIT 1');
    console.log('✅ active_tokens view works!');

  } catch (error) {
    console.error('❌', error.message);
  }
  await pool.end();
}

verify();