/**
 * Test Graduation Simulation
 * Simulates a token graduation to test dashboard updates
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import chalk from 'chalk';

async function simulateGraduation() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    console.log(chalk.cyan('🧪 Testing Graduation Simulation\n'));
    
    // Find a high-progress bonding curve token that hasn't graduated
    const candidateResult = await pool.query(`
      SELECT mint_address, symbol, name, latest_market_cap_usd, latest_bonding_curve_progress
      FROM tokens_unified
      WHERE graduated_to_amm = false
        AND latest_bonding_curve_progress > 80
        AND latest_market_cap_usd > 5000
      ORDER BY latest_bonding_curve_progress DESC
      LIMIT 1
    `);
    
    if (candidateResult.rows.length === 0) {
      console.log('No suitable tokens found for graduation simulation.');
      console.log('Looking for any non-graduated token instead...\n');
      
      const anyToken = await pool.query(`
        SELECT mint_address, symbol, name, latest_market_cap_usd, latest_bonding_curve_progress
        FROM tokens_unified
        WHERE graduated_to_amm = false
          AND latest_market_cap_usd > 1000
        ORDER BY latest_market_cap_usd DESC
        LIMIT 1
      `);
      
      if (anyToken.rows.length === 0) {
        console.log('No tokens found for testing.');
        return;
      }
      
      candidateResult.rows = anyToken.rows;
    }
    
    const token = candidateResult.rows[0];
    console.log('Selected token for graduation simulation:');
    console.log(`- Symbol: ${token.symbol || 'Unknown'}`);
    console.log(`- Mint: ${token.mint_address}`);
    console.log(`- Market Cap: $${Number(token.latest_market_cap_usd).toLocaleString()}`);
    console.log(`- Progress: ${token.latest_bonding_curve_progress}%\n`);
    
    // Step 1: Mark bonding curve as complete
    console.log(chalk.yellow('Step 1: Marking bonding curve as complete...'));
    await pool.query(`
      UPDATE tokens_unified
      SET bonding_curve_complete = true,
          latest_bonding_curve_progress = 100,
          updated_at = NOW()
      WHERE mint_address = $1
    `, [token.mint_address]);
    console.log('✅ Bonding curve marked complete\n');
    
    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 2: Simulate AMM trade (which triggers graduation)
    console.log(chalk.yellow('Step 2: Simulating AMM trade...'));
    await pool.query(`
      INSERT INTO trades_unified (
        signature, mint_address, trade_type, program,
        sol_amount, token_amount, price_usd, market_cap_usd,
        trader_address, transaction_timestamp, created_at
      ) VALUES (
        'test_graduation_' || gen_random_uuid()::text,
        $1, 'buy', 'amm_pool',
        1000000000, 1000000, 150.0, $2,
        'TestGraduationSimulator11111111111111111111',
        NOW(), NOW()
      )
    `, [token.mint_address, token.latest_market_cap_usd]);
    console.log('✅ AMM trade created\n');
    
    // Step 3: Mark as graduated
    console.log(chalk.yellow('Step 3: Marking token as graduated...'));
    await pool.query(`
      UPDATE tokens_unified
      SET graduated_to_amm = true,
          current_program = 'amm_pool',
          updated_at = NOW()
      WHERE mint_address = $1
    `, [token.mint_address]);
    console.log('✅ Token marked as graduated\n');
    
    // Verify the graduation
    const verifyResult = await pool.query(`
      SELECT 
        symbol, graduated_to_amm, bonding_curve_complete, 
        current_program, latest_bonding_curve_progress,
        (SELECT COUNT(*) FROM trades_unified WHERE mint_address = $1 AND program = 'amm_pool') as amm_trades
      FROM tokens_unified
      WHERE mint_address = $1
    `, [token.mint_address]);
    
    const verified = verifyResult.rows[0];
    console.log(chalk.green('🎉 Graduation Simulation Complete!\n'));
    console.log('Token Status:');
    console.log(`- Symbol: ${verified.symbol || 'Unknown'}`);
    console.log(`- Graduated: ${verified.graduated_to_amm ? '✅ YES' : '❌ NO'}`);
    console.log(`- BC Complete: ${verified.bonding_curve_complete ? '✅ YES' : '❌ NO'}`);
    console.log(`- Current Program: ${verified.current_program}`);
    console.log(`- Progress: ${verified.latest_bonding_curve_progress}%`);
    console.log(`- AMM Trades: ${verified.amm_trades}`);
    
    console.log('\n' + chalk.cyan('Check the dashboard at http://localhost:3001'));
    console.log('The token should now appear in the "Graduated" tab');
    console.log(`Direct link: http://localhost:3001/token/${token.mint_address}`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

simulateGraduation().catch(console.error);