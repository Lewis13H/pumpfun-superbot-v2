#!/usr/bin/env node

/**
 * Simple test for pump.fun data - JavaScript version
 */

const { Pool } = require('pg');
const chalk = require('chalk');

const pool = new Pool({
  connectionString: 'postgresql://lewisharding@localhost:5432/pump_monitor'
});

async function testPumpFunData() {
  console.log(chalk.blue('🧪 Testing pump.fun data...\n'));
  
  try {
    // Check schema
    console.log(chalk.yellow('📊 Checking database schema...'));
    const schemaResult = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'tokens_unified' 
      AND column_name IN ('creator', 'total_supply', 'bonding_curve_key')
      ORDER BY column_name
    `);
    
    console.log(chalk.green('✅ Schema columns:'));
    schemaResult.rows.forEach(row => {
      console.log(chalk.gray(`  - ${row.column_name}: ${row.data_type}`));
    });
    
    // Check tokens with creator data
    console.log(chalk.yellow('\n📈 Checking tokens with creator data...'));
    const creatorResult = await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(creator) as with_creator,
             COUNT(total_supply) as with_supply,
             COUNT(bonding_curve_key) as with_bc_key
      FROM tokens_unified
      WHERE latest_market_cap_usd > 1000
    `);
    
    const stats = creatorResult.rows[0];
    console.log(chalk.green('✅ Token statistics:'));
    console.log(chalk.gray(`  - Total tokens > $1k: ${stats.total}`));
    console.log(chalk.gray(`  - With creator: ${stats.with_creator} (${(stats.with_creator/stats.total*100).toFixed(1)}%)`));
    console.log(chalk.gray(`  - With supply: ${stats.with_supply} (${(stats.with_supply/stats.total*100).toFixed(1)}%)`));
    console.log(chalk.gray(`  - With BC key: ${stats.with_bc_key} (${(stats.with_bc_key/stats.total*100).toFixed(1)}%)`));
    
    // Show some examples
    console.log(chalk.yellow('\n🔍 Sample tokens with pump.fun data:'));
    const sampleResult = await pool.query(`
      SELECT mint_address, symbol, name, creator, total_supply
      FROM tokens_unified
      WHERE creator IS NOT NULL
      ORDER BY latest_market_cap_usd DESC
      LIMIT 5
    `);
    
    if (sampleResult.rows.length > 0) {
      sampleResult.rows.forEach(token => {
        console.log(chalk.cyan(`\n${token.symbol || 'Unknown'} - ${token.name || 'Unknown'}`));
        console.log(chalk.gray(`  Mint: ${token.mint_address.slice(0,16)}...`));
        console.log(chalk.gray(`  Creator: ${token.creator}`));
        console.log(chalk.gray(`  Supply: ${token.total_supply || 'N/A'}`));
      });
    }
    
    // Check recent trades with BC key
    console.log(chalk.yellow('\n📊 Recent trades with bonding curve data:'));
    const tradesResult = await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(bonding_curve_key) as with_bc_key
      FROM trades_unified
      WHERE program = 'bonding_curve'
      AND block_time > NOW() - INTERVAL '1 hour'
    `);
    
    const tradeStats = tradesResult.rows[0];
    console.log(chalk.green('✅ Recent trade statistics (last hour):'));
    console.log(chalk.gray(`  - Total BC trades: ${tradeStats.total}`));
    console.log(chalk.gray(`  - With BC key: ${tradeStats.with_bc_key} (${(tradeStats.with_bc_key/tradeStats.total*100).toFixed(1)}%)`));
    
  } catch (error) {
    console.error(chalk.red('❌ Error:'), error.message);
  } finally {
    await pool.end();
  }
}

// Run test
testPumpFunData().catch(console.error);