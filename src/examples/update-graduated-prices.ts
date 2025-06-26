import dotenv from 'dotenv';
import { GraduatedPriceUpdater } from '../services/graduated-price-updater';
import { db } from '../database';

dotenv.config();

async function main() {
  console.log('🎓 Graduated Token Price Updater\n');
  
  const updater = GraduatedPriceUpdater.getInstance();
  
  // Check for specific token or update all
  const tokenAddress = process.argv[2];
  
  if (tokenAddress) {
    // Update single token
    console.log(`Updating price for token: ${tokenAddress}`);
    const success = await updater.updateSingleTokenPrice(tokenAddress);
    
    if (success) {
      // Show the latest price
      const result = await db.query(`
        SELECT name, symbol, last_price_usd, last_updated
        FROM tokens
        WHERE address = $1
      `, [tokenAddress]);
      
      if (result.rows.length > 0) {
        const token = result.rows[0];
        console.log(`\n✅ ${token.name} (${token.symbol})`);
        console.log(`   Price: $${token.last_price_usd}`);
        console.log(`   Updated: ${token.last_updated}`);
      }
    }
  } else {
    // Update all graduated tokens
    console.log('Updating all graduated token prices...\n');
    await updater.updatePrices();
    
    // Show summary
    const result = await db.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(last_price_usd) as updated,
        MIN(last_price_usd) as min_price,
        MAX(last_price_usd) as max_price,
        AVG(last_price_usd) as avg_price
      FROM tokens
      WHERE graduated = true
    `);
    
    const stats = result.rows[0];
    console.log('\n📊 Summary:');
    console.log(`   Total graduated tokens: ${stats.total}`);
    console.log(`   Successfully updated: ${stats.updated}`);
    if (stats.updated > 0) {
      console.log(`   Price range: $${parseFloat(stats.min_price).toFixed(6)} - $${parseFloat(stats.max_price).toLocaleString()}`);
      console.log(`   Average price: $${parseFloat(stats.avg_price).toLocaleString()}`);
    }
  }
  
  process.exit(0);
}

// Run the updater
main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});