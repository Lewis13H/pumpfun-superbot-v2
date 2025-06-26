import dotenv from 'dotenv';
import { db } from '../database';

dotenv.config();

async function main() {
  console.log('🎓 Graduated Tokens Report\n');
  
  try {
    // Get all graduated tokens with their latest data
    const result = await db.query(`
      SELECT 
        t.address,
        t.name,
        t.symbol,
        t.graduated,
        t.graduation_time,
        t.pool_address,
        t.graduation_sol_amount,
        t.last_price_usd,
        t.last_updated,
        t.created_at,
        EXTRACT(EPOCH FROM (t.graduation_time - t.created_at))/3600 as hours_to_graduate,
        (SELECT price_usd FROM price_updates WHERE token = t.address AND is_graduated = false ORDER BY time DESC LIMIT 1) as last_bonding_price
      FROM tokens t
      WHERE t.graduated = true
      ORDER BY t.graduation_time DESC NULLS LAST
    `);

    if (result.rows.length === 0) {
      console.log('No graduated tokens found in the database.');
      return;
    }

    console.log(`Found ${result.rows.length} graduated tokens:\n`);
    
    for (const token of result.rows) {
      console.log(`🪙 ${token.name} (${token.symbol})`);
      console.log(`   Address: ${token.address}`);
      
      if (token.graduation_time) {
        console.log(`   Graduated: ${new Date(token.graduation_time).toLocaleString()}`);
        if (token.hours_to_graduate) {
          console.log(`   Time to graduate: ${token.hours_to_graduate.toFixed(1)} hours`);
        }
      } else {
        console.log(`   Graduated: Yes (time unknown)`);
      }
      
      if (token.pool_address) {
        console.log(`   Pool: ${token.pool_address}`);
      }
      
      if (token.graduation_sol_amount) {
        console.log(`   Graduation SOL: ${token.graduation_sol_amount} SOL`);
      }
      
      // Price comparison
      if (token.last_bonding_price && token.last_price_usd) {
        const priceChange = ((token.last_price_usd - token.last_bonding_price) / token.last_bonding_price) * 100;
        console.log(`   Last bonding price: $${parseFloat(token.last_bonding_price).toLocaleString()}`);
        console.log(`   Current price: $${parseFloat(token.last_price_usd).toLocaleString()}`);
        console.log(`   Change since graduation: ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(2)}%`);
      } else if (token.last_price_usd) {
        console.log(`   Current price: $${parseFloat(token.last_price_usd).toLocaleString()}`);
      }
      
      if (token.last_updated) {
        console.log(`   Last updated: ${new Date(token.last_updated).toLocaleString()}`);
      }
      
      console.log('');
    }
    
    // Summary statistics
    const stats = await db.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(graduation_time) as with_time,
        COUNT(pool_address) as with_pool,
        COUNT(last_price_usd) as with_current_price,
        AVG(graduation_sol_amount) as avg_graduation_sol,
        MIN(graduation_time) as first_graduation,
        MAX(graduation_time) as last_graduation
      FROM tokens
      WHERE graduated = true
    `);
    
    const stat = stats.rows[0];
    console.log('📊 Summary:');
    console.log(`   Total graduated: ${stat.total}`);
    console.log(`   With graduation time: ${stat.with_time}`);
    console.log(`   With pool address: ${stat.with_pool}`);
    console.log(`   With current price: ${stat.with_current_price}`);
    
    if (stat.avg_graduation_sol) {
      console.log(`   Avg graduation SOL: ${parseFloat(stat.avg_graduation_sol).toFixed(2)} SOL`);
    }
    
    if (stat.first_graduation && stat.last_graduation) {
      console.log(`   First graduation: ${new Date(stat.first_graduation).toLocaleDateString()}`);
      console.log(`   Latest graduation: ${new Date(stat.last_graduation).toLocaleDateString()}`);
    }
    
  } catch (error) {
    console.error('Error fetching graduated tokens:', error);
  } finally {
    process.exit(0);
  }
}

main();