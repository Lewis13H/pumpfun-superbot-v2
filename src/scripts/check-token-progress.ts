import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkToken() {
  const mint = '95ifG7SAJfSzRSTqZ4p9KGUoZvvebxJMpR16WLHFuTr4';
  
  try {
    const result = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        latest_bonding_curve_progress,
        bonding_curve_complete,
        graduated_to_amm,
        latest_price_sol,
        latest_market_cap_usd,
        threshold_crossed_at,
        created_at,
        updated_at
      FROM tokens_unified
      WHERE mint_address = $1
    `, [mint]);
    
    if (result.rows.length > 0) {
      console.log('Token data:', JSON.stringify(result.rows[0], null, 2));
    } else {
      console.log('Token not found');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

checkToken();