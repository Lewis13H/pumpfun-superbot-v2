import dotenv from 'dotenv';
import { GraduationChecker } from '../services/graduation-checker';
import { GraduatedPriceUpdater } from '../services/graduated-price-updater';
import { db } from '../database';

dotenv.config();

async function main() {
  console.log('🎓 Token Graduation Status Checker\n');
  
  const checker = GraduationChecker.getInstance();
  const priceUpdater = GraduatedPriceUpdater.getInstance();
  
  // Check specific token if provided
  const tokenAddress = process.argv[2];
  
  if (tokenAddress) {
    // Check single token
    console.log(`Checking graduation status for: ${tokenAddress}\n`);
    
    const graduated = await checker.checkSingleTokenGraduation(tokenAddress);
    
    if (graduated) {
      console.log('\n💰 Fetching current price data...');
      await priceUpdater.updateSingleTokenPrice(tokenAddress);
    } else {
      console.log('Token has not graduated to Raydium yet.');
    }
  } else {
    // Check all tokens
    await checker.checkAllTokensForGraduation();
    
    // Show summary
    await checker.getGraduationSummary();
    
    // Ask if user wants to update all graduated token prices
    const graduatedResult = await db.query(`
      SELECT COUNT(*) as count 
      FROM tokens 
      WHERE graduated = true 
      AND (last_updated IS NULL OR last_updated < NOW() - INTERVAL '1 hour')
    `);
    
    const needUpdate = graduatedResult.rows[0].count;
    
    if (needUpdate > 0) {
      console.log(`\n💡 ${needUpdate} graduated tokens need price updates.`);
      console.log('Run "npm run update-graduated" to update all prices.');
    }
  }
  
  process.exit(0);
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});