/**
 * Test AMM Database Integration
 * Verifies that AMM trades are being saved to database and marked as graduated
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import { spawn } from 'child_process';

async function getTokenStats(pool: Pool) {
  const result = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE graduated_to_amm = true) as graduated,
      COUNT(*) FILTER (WHERE current_program = 'amm_pool') as amm_program,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 hour') as new_last_hour,
      COUNT(*) FILTER (WHERE graduated_to_amm = true AND updated_at >= NOW() - INTERVAL '10 minutes') as recent_graduations
    FROM tokens_unified
  `);
  return result.rows[0];
}

async function getRecentAmmTokens(pool: Pool) {
  const result = await pool.query(`
    SELECT 
      mint_address,
      symbol,
      name,
      current_price_usd,
      current_market_cap_usd,
      graduated_to_amm,
      current_program,
      created_at,
      updated_at
    FROM tokens_unified
    WHERE current_program = 'amm_pool' 
       OR graduated_to_amm = true
       OR updated_at >= NOW() - INTERVAL '10 minutes'
    ORDER BY updated_at DESC
    LIMIT 10
  `);
  return result.rows;
}

async function getRecentTrades(pool: Pool) {
  const result = await pool.query(`
    SELECT 
      COUNT(*) as total_trades,
      COUNT(*) FILTER (WHERE program = 'amm_pool') as amm_trades,
      COUNT(*) FILTER (WHERE program = 'bonding_curve') as bc_trades,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '10 minutes') as recent_trades
    FROM trades_unified
    WHERE created_at >= NOW() - INTERVAL '1 hour'
  `);
  return result.rows[0];
}

async function main() {
  console.log('🔍 Testing AMM Database Integration\n');
  console.log('This test will:');
  console.log('1. Check initial database state');
  console.log('2. Run the monitor for 2 minutes');
  console.log('3. Track new AMM tokens and graduations');
  console.log('4. Verify dashboard updates\n');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    // Get initial state
    console.log('📊 Initial Database State:');
    const initialStats = await getTokenStats(pool);
    const initialTrades = await getRecentTrades(pool);
    
    console.log(`Total tokens: ${initialStats.total}`);
    console.log(`Graduated tokens: ${initialStats.graduated} (${(initialStats.graduated / initialStats.total * 100).toFixed(1)}%)`);
    console.log(`AMM program tokens: ${initialStats.amm_program}`);
    console.log(`New tokens (last hour): ${initialStats.new_last_hour}`);
    console.log(`\nRecent trades: ${initialTrades.recent_trades} (AMM: ${initialTrades.amm_trades}, BC: ${initialTrades.bc_trades})`);
    
    // Show recent AMM tokens
    const recentTokens = await getRecentAmmTokens(pool);
    if (recentTokens.length > 0) {
      console.log('\n📋 Recent AMM/Updated Tokens:');
      recentTokens.forEach((token, i) => {
        if (i < 5) {
          console.log(`${i + 1}. ${token.symbol || 'N/A'} - ${token.mint_address.slice(0, 8)}...`);
          console.log(`   Graduated: ${token.graduated_to_amm ? '✅' : '❌'} | Program: ${token.current_program}`);
          console.log(`   Market Cap: $${token.current_market_cap_usd?.toFixed(2) || '0'}`);
        }
      });
    }
    
    // Start monitoring
    console.log('\n\n🚀 Starting monitor to detect AMM trades and graduations...\n');
    
    const monitor = spawn('npm', ['run', 'start'], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let ammTradeCount = 0;
    let graduationCount = 0;
    let errorCount = 0;
    const detectedTokens = new Set<string>();
    
    // Monitor output
    monitor.stdout.on('data', (data) => {
      const output = data.toString();
      
      // Look for AMM trades
      if (output.includes('AMM trade') || output.includes('AMM_TRADE')) {
        ammTradeCount++;
        
        // Try to extract mint address
        const mintMatch = output.match(/mint[:\s]+([A-Za-z0-9]{32,44})/i);
        if (mintMatch) {
          detectedTokens.add(mintMatch[1]);
        }
        
        // Show progress
        if (ammTradeCount % 10 === 0) {
          console.log(`⚡ Detected ${ammTradeCount} AMM trades so far...`);
        }
      }
      
      // Look for graduations
      if (output.includes('Token graduation to AMM detected')) {
        graduationCount++;
        console.log(`\n🎓 GRADUATION DETECTED! Total: ${graduationCount}`);
        
        // Try to show the graduation details
        const lines = output.split('\n');
        lines.forEach(line => {
          if (line.includes('graduation') && line.includes('mintAddress')) {
            console.log(`   ${line.trim()}`);
          }
        });
      }
      
      // Look for saved tokens
      if (output.includes('New token discovered') && output.includes('AMM')) {
        console.log(`\n💾 New AMM token saved to database!`);
      }
    });
    
    monitor.stderr.on('data', (data) => {
      const error = data.toString();
      if (!error.includes('DeprecationWarning') && !error.includes('punycode')) {
        errorCount++;
        if (error.includes('rate limit') || error.includes('PERMISSION_DENIED')) {
          console.error('\n⚠️  Rate limit error - waiting for it to clear...');
        }
      }
    });
    
    // Periodic database checks
    const checkInterval = setInterval(async () => {
      try {
        const currentStats = await getTokenStats(pool);
        const currentTrades = await getRecentTrades(pool);
        
        const newGraduations = currentStats.graduated - initialStats.graduated;
        const newAmmTokens = currentStats.amm_program - initialStats.amm_program;
        const newTrades = currentTrades.amm_trades - initialTrades.amm_trades;
        
        console.log(`\n📈 Progress Update:`);
        console.log(`   New graduations: ${newGraduations}`);
        console.log(`   New AMM tokens: ${newAmmTokens}`);
        console.log(`   New AMM trades in DB: ${newTrades}`);
        console.log(`   Unique tokens detected: ${detectedTokens.size}`);
      } catch (e) {
        // Ignore errors during periodic checks
      }
    }, 30000); // Every 30 seconds
    
    // Run for 2 minutes
    await new Promise(resolve => setTimeout(resolve, 120000));
    
    // Stop monitoring
    clearInterval(checkInterval);
    monitor.kill();
    console.log('\n\n⏹️  Stopping monitor...\n');
    
    // Wait a bit for final saves
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Final database check
    console.log('📊 Final Database State:');
    const finalStats = await getTokenStats(pool);
    const finalTrades = await getRecentTrades(pool);
    
    const totalNewGraduations = finalStats.graduated - initialStats.graduated;
    const totalNewAmmTokens = finalStats.amm_program - initialStats.amm_program;
    const totalNewTrades = finalTrades.amm_trades - initialTrades.amm_trades;
    
    console.log(`Total tokens: ${finalStats.total} (+${finalStats.total - initialStats.total})`);
    console.log(`Graduated tokens: ${finalStats.graduated} (+${totalNewGraduations})`);
    console.log(`AMM program tokens: ${finalStats.amm_program} (+${totalNewAmmTokens})`);
    console.log(`\nAMM trades processed: ${ammTradeCount}`);
    console.log(`AMM trades saved to DB: ${totalNewTrades}`);
    console.log(`Graduations detected: ${graduationCount}`);
    console.log(`Unique tokens seen: ${detectedTokens.size}`);
    
    // Show new AMM tokens
    if (totalNewAmmTokens > 0 || totalNewGraduations > 0) {
      console.log('\n🆕 New AMM Tokens/Graduations:');
      const newTokens = await pool.query(`
        SELECT mint_address, symbol, name, current_market_cap_usd, graduated_to_amm
        FROM tokens_unified
        WHERE (graduated_to_amm = true OR current_program = 'amm_pool')
          AND updated_at >= NOW() - INTERVAL '3 minutes'
        ORDER BY updated_at DESC
        LIMIT 10
      `);
      
      newTokens.rows.forEach((token, i) => {
        console.log(`${i + 1}. ${token.symbol || 'N/A'} - ${token.mint_address.slice(0, 8)}...`);
        console.log(`   Market Cap: $${token.current_market_cap_usd?.toFixed(2) || '0'}`);
      });
    }
    
    // Check dashboard
    console.log('\n🌐 Dashboard Check:');
    console.log('Open http://localhost:3001 in your browser');
    console.log('Filter by "Graduated" to see AMM tokens');
    console.log('New tokens should appear within 10 seconds');
    
    // Summary
    console.log('\n📝 Summary:');
    if (totalNewAmmTokens > 0 || totalNewGraduations > 0) {
      console.log('✅ SUCCESS: AMM trades are being saved and tokens are being marked as graduated!');
      console.log(`   - ${totalNewAmmTokens} new AMM tokens in database`);
      console.log(`   - ${totalNewGraduations} tokens marked as graduated`);
      console.log(`   - ${totalNewTrades} AMM trades saved`);
    } else if (ammTradeCount > 0) {
      console.log('⚠️  AMM trades were detected but no new graduations recorded.');
      console.log('   This could mean:');
      console.log('   - These tokens were already graduated');
      console.log('   - The trades were below the save threshold');
      console.log('   - There may be a delay in database updates');
    } else {
      console.log('❌ No AMM trades detected during this test period.');
      console.log('   Try running the test during more active trading hours.');
    }
    
    if (errorCount > 0) {
      console.log(`\n⚠️  Encountered ${errorCount} errors during monitoring`);
    }
    
  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);