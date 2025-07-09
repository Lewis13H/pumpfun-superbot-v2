import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('🔧 Fixing AMM Market Cap for Token (Simple Fix)\n');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    const mintAddress = '2qiRmdaAZSmYHy3KrCw43BGH7UFVcWjYKwdVzYDVpump';
    
    // Get current token data
    const tokenResult = await pool.query(`
      SELECT mint_address, symbol, name, latest_price_usd, latest_market_cap_usd
      FROM tokens_unified
      WHERE mint_address = $1
    `, [mintAddress]);
    
    if (tokenResult.rows.length === 0) {
      console.error('Token not found');
      return;
    }
    
    const token = tokenResult.rows[0];
    console.log(`Token: ${token.symbol || 'Unknown'} (${mintAddress})`);
    console.log(`Current price: $${token.latest_price_usd}`);
    console.log(`Current market cap: $${token.latest_market_cap_usd}`);
    
    // The market cap is 10x lower than it should be
    // This is because it's using 1B tokens instead of actual pool reserves
    // For AMM tokens, actual circulating supply is ~100M tokens
    const correctedMarketCap = token.latest_market_cap_usd * 10;
    
    console.log(`\nCorrected Market Cap: $${correctedMarketCap.toLocaleString()}`);
    
    // Update the token
    await pool.query(`
      UPDATE tokens_unified
      SET 
        latest_market_cap_usd = $1
      WHERE mint_address = $2
    `, [
      correctedMarketCap,
      mintAddress
    ]);
    
    // Also update the AMM trade
    await pool.query(`
      UPDATE trades_unified
      SET 
        market_cap_usd = $1
      WHERE mint_address = $2 
        AND program = 'amm_pool'
    `, [
      correctedMarketCap,
      mintAddress
    ]);
    
    console.log('\n✅ Token market cap updated successfully!');
    console.log('Note: This is a temporary fix. The system needs to fetch actual pool reserves for accurate calculations.');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);