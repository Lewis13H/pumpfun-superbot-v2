/**
 * Live Graduation Monitor
 * Monitors the system for graduation events and AMM trades
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { spawn } from 'child_process';
import { Pool } from 'pg';
import chalk from 'chalk';

async function monitorGraduations() {
  console.log(chalk.cyan('🔍 Live Graduation Monitor\n'));
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    // Get initial counts
    const initial = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM tokens_unified WHERE graduated_to_amm = true) as graduated,
        (SELECT COUNT(*) FROM tokens_unified WHERE bonding_curve_complete = true) as bc_complete,
        (SELECT COUNT(DISTINCT mint_address) FROM trades_unified WHERE program = 'amm_pool') as amm_tokens,
        (SELECT COUNT(*) FROM trades_unified WHERE program = 'amm_pool' AND created_at >= NOW() - INTERVAL '10 minutes') as recent_amm_trades
    `);
    
    console.log('Initial State:');
    console.log(`- Graduated tokens: ${initial.rows[0].graduated}`);
    console.log(`- BC complete: ${initial.rows[0].bc_complete}`);
    console.log(`- Tokens with AMM trades: ${initial.rows[0].amm_tokens}`);
    console.log(`- AMM trades (last 10 min): ${initial.rows[0].recent_amm_trades}\n`);
    
    // Start monitor
    console.log(chalk.green('Starting monitor...\n'));
    const monitor = spawn('npm', ['run', 'start'], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let graduationEvents = 0;
    let ammTrades = 0;
    let bcCompletions = 0;
    
    // Monitor output
    monitor.stdout.on('data', (data) => {
      const output = data.toString();
      
      // Look for graduation events
      if (output.includes('TOKEN GRADUATED') || output.includes('graduation') || output.includes('Graduated')) {
        graduationEvents++;
        console.log(chalk.green(`\n🎓 GRADUATION EVENT #${graduationEvents} DETECTED!`));
        
        // Extract details
        const mintMatch = output.match(/mint[:\s]+([A-Za-z0-9]{8,})/i);
        const symbolMatch = output.match(/symbol[:\s]+([A-Za-z0-9]+)/i);
        const mcapMatch = output.match(/marketCap[:\s]+\$?([0-9,]+\.?\d*)/i);
        
        if (mintMatch) console.log(`   Mint: ${mintMatch[1]}`);
        if (symbolMatch) console.log(`   Symbol: ${symbolMatch[1]}`);
        if (mcapMatch) console.log(`   Market Cap: $${mcapMatch[1]}`);
        console.log(`   Time: ${new Date().toISOString()}\n`);
      }
      
      // Look for AMM trades
      if (output.includes('AMM_TRADE') || (output.includes('AMM') && output.includes('trade'))) {
        ammTrades++;
        if (ammTrades % 10 === 0) {
          console.log(chalk.blue(`📊 ${ammTrades} AMM trades detected`));
        }
      }
      
      // Look for BC completions
      if (output.includes('COMPLETE FLAG DETECTED') || output.includes('complete: true')) {
        bcCompletions++;
        console.log(chalk.yellow(`✅ Bonding curve completion #${bcCompletions}`));
      }
      
      // Look for pool creation
      if (output.includes('create_pool') || output.includes('Pool creation')) {
        console.log(chalk.magenta('\n🏊 POOL CREATION DETECTED!\n'));
      }
    });
    
    monitor.stderr.on('data', (data) => {
      const error = data.toString();
      if (!error.includes('DeprecationWarning') && 
          !error.includes('punycode') && 
          !error.includes('ExperimentalWarning')) {
        // Ignore common warnings
      }
    });
    
    // Check database periodically
    const checkInterval = setInterval(async () => {
      const current = await pool.query(`
        SELECT 
          (SELECT COUNT(*) FROM tokens_unified WHERE graduated_to_amm = true) as graduated,
          (SELECT COUNT(*) FROM tokens_unified WHERE bonding_curve_complete = true) as bc_complete,
          (SELECT COUNT(DISTINCT mint_address) FROM trades_unified WHERE program = 'amm_pool') as amm_tokens,
          (SELECT COUNT(*) FROM trades_unified WHERE program = 'amm_pool' AND created_at >= NOW() - INTERVAL '5 minutes') as recent_amm_trades
      `);
      
      const newGraduations = current.rows[0].graduated - initial.rows[0].graduated;
      const newBcComplete = current.rows[0].bc_complete - initial.rows[0].bc_complete;
      const newAmmTokens = current.rows[0].amm_tokens - initial.rows[0].amm_tokens;
      
      console.log(chalk.gray('\n--- Database Status Update ---'));
      console.log(`Total graduated: ${current.rows[0].graduated} (${newGraduations > 0 ? '+' + newGraduations : newGraduations})`);
      console.log(`BC complete: ${current.rows[0].bc_complete} (${newBcComplete > 0 ? '+' + newBcComplete : newBcComplete})`);
      console.log(`AMM tokens: ${current.rows[0].amm_tokens} (${newAmmTokens > 0 ? '+' + newAmmTokens : newAmmTokens})`);
      console.log(`Recent AMM trades: ${current.rows[0].recent_amm_trades}`);
      console.log(chalk.gray('------------------------------\n'));
      
      // Check for new graduated tokens
      if (newGraduations > 0) {
        const newGrads = await pool.query(`
          SELECT mint_address, symbol, name, latest_market_cap_usd
          FROM tokens_unified
          WHERE graduated_to_amm = true
          ORDER BY updated_at DESC
          LIMIT ${newGraduations}
        `);
        
        console.log(chalk.green('\n🎉 NEW GRADUATED TOKENS:'));
        for (const token of newGrads.rows) {
          console.log(`- ${token.symbol || 'Unknown'} (${token.mint_address.slice(0, 8)}...)`);
          console.log(`  Market Cap: $${Number(token.latest_market_cap_usd).toLocaleString()}\n`);
        }
      }
    }, 30000); // Every 30 seconds
    
    // Monitor for 5 minutes
    setTimeout(async () => {
      clearInterval(checkInterval);
      monitor.kill();
      
      // Final summary
      const final = await pool.query(`
        SELECT 
          (SELECT COUNT(*) FROM tokens_unified WHERE graduated_to_amm = true) as graduated,
          (SELECT COUNT(*) FROM tokens_unified WHERE bonding_curve_complete = true) as bc_complete,
          (SELECT COUNT(DISTINCT mint_address) FROM trades_unified WHERE program = 'amm_pool') as amm_tokens
      `);
      
      console.log(chalk.cyan('\n📊 Final Summary:'));
      console.log(`Graduation events detected: ${graduationEvents}`);
      console.log(`AMM trades seen: ${ammTrades}`);
      console.log(`BC completions: ${bcCompletions}`);
      console.log(`\nDatabase changes:`);
      console.log(`- Graduated tokens: ${initial.rows[0].graduated} → ${final.rows[0].graduated}`);
      console.log(`- BC complete: ${initial.rows[0].bc_complete} → ${final.rows[0].bc_complete}`);
      console.log(`- AMM tokens: ${initial.rows[0].amm_tokens} → ${final.rows[0].amm_tokens}`);
      
      await pool.end();
      process.exit(0);
    }, 300000); // 5 minutes
    
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
    process.exit(1);
  }
}

monitorGraduations().catch(console.error);