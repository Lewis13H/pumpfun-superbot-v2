/**
 * Test script for startup price check functionality
 * This ensures high-value tokens get their prices verified on startup
 */

import { config } from 'dotenv';
import chalk from 'chalk';
import { db } from '../database';
import { EnhancedStaleTokenDetector } from '../services/token-management/enhanced-stale-token-detector';

config();

async function testStartupPriceCheck() {
  console.log(chalk.cyan('🧪 Testing Startup Price Check...\n'));

  try {
    // First, let's check for high-value tokens that might need verification
    console.log(chalk.blue('1️⃣ Checking for high-value tokens ($20k+) with old prices...'));
    
    const highValueTokens = await db.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        latest_market_cap_usd,
        latest_price_sol,
        last_trade_at,
        graduated_to_amm,
        EXTRACT(EPOCH FROM (NOW() - last_trade_at)) / 60 as minutes_since_trade
      FROM tokens_unified
      WHERE latest_market_cap_usd >= 20000
        AND EXTRACT(EPOCH FROM (NOW() - last_trade_at)) / 60 > 30
        AND threshold_crossed_at IS NOT NULL
      ORDER BY latest_market_cap_usd DESC
      LIMIT 10
    `);

    if (highValueTokens.rows.length === 0) {
      console.log(chalk.yellow('No high-value tokens found needing price verification'));
      console.log(chalk.gray('Checking all tokens above $10k instead...'));
      
      // Check with lower threshold
      const lowerThresholdResult = await db.query(`
        SELECT COUNT(*) as count
        FROM tokens_unified
        WHERE latest_market_cap_usd >= 10000
          AND threshold_crossed_at IS NOT NULL
      `);
      
      console.log(chalk.gray(`Found ${lowerThresholdResult.rows[0].count} tokens above $10k`));
    } else {
      console.log(chalk.green(`✅ Found ${highValueTokens.rows.length} tokens needing verification:\n`));
      
      highValueTokens.rows.forEach(token => {
        const ageInHours = Math.round(token.minutes_since_trade / 60);
        console.log(chalk.yellow(
          `   ${token.symbol || 'Unknown'} (${token.mint_address.slice(0, 8)}...)`
        ));
        console.log(chalk.gray(
          `   Market Cap: $${token.latest_market_cap_usd.toLocaleString()}`
        ));
        console.log(chalk.gray(
          `   Last Trade: ${ageInHours < 1 ? Math.round(token.minutes_since_trade) + ' minutes' : ageInHours + ' hours'} ago`
        ));
        console.log(chalk.gray(
          `   Type: ${token.graduated_to_amm ? 'AMM' : 'Bonding Curve'}\n`
        ));
      });
    }

    // Check if Paperbon specifically exists
    console.log(chalk.blue('\n2️⃣ Checking for Paperbon specifically...'));
    const paperbonResult = await db.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        latest_market_cap_usd,
        latest_price_sol,
        last_trade_at,
        graduated_to_amm,
        EXTRACT(EPOCH FROM (NOW() - last_trade_at)) / 60 as minutes_since_trade
      FROM tokens_unified
      WHERE mint_address = 'HEjeMXtG3Y8j7QCGLaU9QFdkk1shRmid9ThXbRaJpump'
    `);

    if (paperbonResult.rows.length > 0) {
      const paperbon = paperbonResult.rows[0];
      console.log(chalk.yellow('📍 Found Paperbon:'));
      console.log(chalk.gray(`   Current Market Cap: $${paperbon.latest_market_cap_usd.toLocaleString()}`));
      console.log(chalk.gray(`   Last Trade: ${Math.round(paperbon.minutes_since_trade)} minutes ago`));
      console.log(chalk.gray(`   Type: ${paperbon.graduated_to_amm ? 'AMM' : 'Bonding Curve'}`));
    } else {
      console.log(chalk.gray('Paperbon not found in database'));
    }

    // Now test the enhanced stale token detector with startup check
    console.log(chalk.blue('\n3️⃣ Initializing Enhanced Stale Token Detector with startup check...'));
    
    const detector = EnhancedStaleTokenDetector.getInstance({
      enableStartupPriceCheck: true,
      startupPriceCheckThreshold: 20000,
      startupCheckMaxAge: 30,
      enableDetailedLogging: true,
      scanIntervalMinutes: 999 // Don't run regular scans during test
    });

    // Start the detector (this will trigger the startup price check)
    await detector.start();
    
    // Wait a bit to see the startup check in action
    console.log(chalk.blue('\n⏳ Waiting 10 seconds to observe price recovery queue...'));
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Check stats
    const stats = detector.getEnhancedStats();
    console.log(chalk.blue('\n📊 Detector Statistics:'));
    console.log(chalk.gray(`   Tokens Scanned: ${stats.totalTokensScanned}`));
    console.log(chalk.gray(`   Stale Tokens Found: ${stats.staleTokensFound}`));
    console.log(chalk.gray(`   Tokens Recovered: ${stats.tokensRecovered}`));
    console.log(chalk.gray(`   Current Queue Depth: ${stats.currentQueueDepth}`));
    console.log(chalk.gray(`   Recovery Success Rate: ${(stats.recoverySuccessRate * 100).toFixed(1)}%`));
    
    // Stop the detector
    detector.stop();
    
    console.log(chalk.green('\n✅ Test completed!'));
    console.log(chalk.cyan('\nNext steps:'));
    console.log(chalk.gray('1. If tokens were queued, wait for recovery to complete'));
    console.log(chalk.gray('2. Check dashboard to see if prices have been corrected'));
    console.log(chalk.gray('3. Run "npm run start" to enable this in production'));

  } catch (error) {
    console.error(chalk.red('Test failed:'), error);
  } finally {
    process.exit(0);
  }
}

// Run the test
testStartupPriceCheck().catch(console.error);