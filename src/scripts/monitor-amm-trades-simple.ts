/**
 * Simple AMM Trade Monitor
 * Monitors AMM trades and checks if they're being saved
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { spawn } from 'child_process';
import { Pool } from 'pg';

async function countAmmTrades(pool: Pool) {
  const result = await pool.query(`
    SELECT COUNT(*) as count
    FROM trades_unified
    WHERE program = 'amm_pool'
      AND created_at >= NOW() - INTERVAL '5 minutes'
  `);
  return result.rows[0].count;
}

async function main() {
  console.log('🔍 Monitoring AMM Trades\n');
  console.log(`AMM Save Threshold: $${process.env.AMM_SAVE_THRESHOLD || '1000'}\n`);
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    // Initial count
    const initialCount = await countAmmTrades(pool);
    console.log(`Initial AMM trades (last 5 min): ${initialCount}\n`);
    
    // Start monitor
    console.log('Starting monitor...\n');
    const monitor = spawn('npm', ['run', 'start'], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let ammTradesSeen = 0;
    let graduationsSeen = 0;
    
    // Monitor output
    monitor.stdout.on('data', (data) => {
      const output = data.toString();
      
      // Look for AMM trades
      if (output.includes('AMM trade') || output.includes('AMM_TRADE')) {
        ammTradesSeen++;
        
        // Extract details if possible
        const marketCapMatch = output.match(/marketCap[:\s]+\$?([\d,]+\.?\d*)/i);
        const mintMatch = output.match(/mint[:\s]+([A-Za-z0-9]{8,})/i);
        
        if (marketCapMatch || mintMatch) {
          console.log(`📊 AMM Trade #${ammTradesSeen}:`);
          if (mintMatch) console.log(`   Mint: ${mintMatch[1].slice(0, 16)}...`);
          if (marketCapMatch) {
            const marketCap = parseFloat(marketCapMatch[1].replace(/,/g, ''));
            console.log(`   Market Cap: $${marketCap.toLocaleString()}`);
            if (marketCap >= 1000) {
              console.log(`   ✅ Above threshold - should be saved`);
            } else {
              console.log(`   ❌ Below threshold - won't be saved`);
            }
          }
        } else if (ammTradesSeen % 10 === 0) {
          console.log(`📈 ${ammTradesSeen} AMM trades detected...`);
        }
      }
      
      // Look for graduations
      if (output.includes('graduation') && output.includes('AMM')) {
        graduationsSeen++;
        console.log(`\n🎓 Graduation detected! Total: ${graduationsSeen}\n`);
      }
      
      // Look for save confirmations
      if (output.includes('New token discovered') && output.includes('AMM')) {
        console.log(`💾 New AMM token saved!`);
      }
      
      if (output.includes('Saved') && output.includes('trades')) {
        const match = output.match(/Saved (\d+) trades/);
        if (match) {
          console.log(`💾 Batch saved ${match[1]} trades`);
        }
      }
    });
    
    monitor.stderr.on('data', (data) => {
      const error = data.toString();
      if (!error.includes('DeprecationWarning') && 
          !error.includes('punycode') && 
          !error.includes('rate limit')) {
        console.error('Error:', error);
      }
    });
    
    // Check database periodically
    const checkInterval = setInterval(async () => {
      const currentCount = await countAmmTrades(pool);
      const newTrades = currentCount - initialCount;
      
      console.log(`\n📊 Database Check:`);
      console.log(`   AMM trades in stream: ${ammTradesSeen}`);
      console.log(`   AMM trades in DB: ${newTrades}`);
      console.log(`   Save rate: ${ammTradesSeen > 0 ? (newTrades / ammTradesSeen * 100).toFixed(1) : 0}%\n`);
    }, 30000);
    
    // Run for 2 minutes
    setTimeout(async () => {
      clearInterval(checkInterval);
      monitor.kill();
      
      // Final check
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const finalCount = await countAmmTrades(pool);
      const totalNewTrades = finalCount - initialCount;
      
      console.log('\n📊 Final Results:');
      console.log(`AMM trades seen: ${ammTradesSeen}`);
      console.log(`AMM trades saved to DB: ${totalNewTrades}`);
      console.log(`Graduations detected: ${graduationsSeen}`);
      
      if (totalNewTrades > 0) {
        console.log('\n✅ SUCCESS: AMM trades are being saved!');
        
        // Show some saved trades
        const savedTrades = await pool.query(`
          SELECT 
            t.mint_address,
            t.signature,
            t.trade_type,
            t.sol_amount,
            t.created_at,
            tk.symbol,
            tk.graduated_to_amm
          FROM trades_unified t
          LEFT JOIN tokens_unified tk ON t.mint_address = tk.mint_address
          WHERE t.program = 'amm_pool'
            AND t.created_at >= NOW() - INTERVAL '3 minutes'
          ORDER BY t.created_at DESC
          LIMIT 5
        `);
        
        if (savedTrades.rows.length > 0) {
          console.log('\nSample saved AMM trades:');
          savedTrades.rows.forEach((trade, i) => {
            console.log(`${i + 1}. ${trade.symbol || 'N/A'} - ${trade.trade_type}`);
            console.log(`   Amount: ${(Number(trade.sol_amount) / 1e9).toFixed(3)} SOL`);
            console.log(`   Graduated: ${trade.graduated_to_amm ? '✅' : '❌'}`);
          });
        }
      } else if (ammTradesSeen > 0) {
        console.log('\n⚠️  AMM trades detected but not saved.');
        console.log('Possible reasons:');
        console.log('- Market cap below $1000 threshold');
        console.log('- Price calculation issues');
        console.log('- Database connection issues');
      } else {
        console.log('\n❌ No AMM trades detected');
      }
      
      await pool.end();
      process.exit(0);
    }, 120000);
    
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
    process.exit(1);
  }
}

main().catch(console.error);