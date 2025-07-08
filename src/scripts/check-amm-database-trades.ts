import { Pool } from 'pg';
import { format } from 'date-fns';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkAMMTrades() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('🔍 Checking AMM trades in database...\n');

    // 1. Get total AMM trade count
    const totalCountResult = await pool.query(`
      SELECT COUNT(*) as total_count
      FROM trades_unified
      WHERE program = 'amm_pool'
    `);
    const totalCount = parseInt(totalCountResult.rows[0].total_count);
    console.log(`📊 Total AMM trades in database: ${totalCount.toLocaleString()}`);

    // 2. Get AMM trades in last hour
    const lastHourResult = await pool.query(`
      SELECT COUNT(*) as hour_count
      FROM trades_unified
      WHERE program = 'amm_pool'
      AND created_at >= NOW() - INTERVAL '1 hour'
    `);
    const hourCount = parseInt(lastHourResult.rows[0].hour_count);
    console.log(`📊 AMM trades in last hour: ${hourCount.toLocaleString()}`);

    // 3. Get AMM trades in last 5 minutes (to check if real-time)
    const last5MinResult = await pool.query(`
      SELECT COUNT(*) as recent_count
      FROM trades_unified
      WHERE program = 'amm_pool'
      AND created_at >= NOW() - INTERVAL '5 minutes'
    `);
    const recentCount = parseInt(last5MinResult.rows[0].recent_count);
    console.log(`📊 AMM trades in last 5 minutes: ${recentCount.toLocaleString()}`);

    // 4. Get time distribution of AMM trades (last 24 hours by hour)
    console.log('\n📈 AMM trades by hour (last 24 hours):');
    const distributionResult = await pool.query(`
      SELECT 
        DATE_TRUNC('hour', created_at) as hour,
        COUNT(*) as trade_count
      FROM trades_unified
      WHERE program = 'amm_pool'
      AND created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY hour
      ORDER BY hour DESC
    `);

    distributionResult.rows.forEach(row => {
      const hour = format(new Date(row.hour), 'yyyy-MM-dd HH:mm');
      const count = parseInt(row.trade_count);
      const bar = '█'.repeat(Math.min(50, Math.floor(count / 10)));
      console.log(`${hour}: ${count.toString().padStart(5)} ${bar}`);
    });

    // 5. Get sample of recent AMM trades
    console.log('\n📋 Sample of recent AMM trades:');
    const sampleResult = await pool.query(`
      SELECT 
        t.id,
        t.signature,
        t.created_at,
        t.trade_type,
        t.sol_amount,
        t.token_amount,
        t.price_sol,
        t.price_usd,
        tk.symbol,
        tk.name,
        t.mint_address
      FROM trades_unified t
      LEFT JOIN tokens_unified tk ON t.mint_address = tk.mint_address
      WHERE t.program = 'amm_pool'
      ORDER BY t.created_at DESC
      LIMIT 10
    `);

    console.log('\nRecent trades:');
    sampleResult.rows.forEach((trade, index) => {
      const time = format(new Date(trade.created_at), 'HH:mm:ss');
      const symbol = trade.symbol || 'Unknown';
      const type = trade.trade_type;
      const solAmount = (parseFloat(trade.sol_amount) / 1e9).toFixed(4);
      const priceUsd = trade.price_usd ? `$${parseFloat(trade.price_usd).toFixed(6)}` : 'N/A';
      
      console.log(`${index + 1}. [${time}] ${symbol} - ${type} - ${solAmount} SOL - ${priceUsd}`);
      console.log(`   Mint: ${trade.mint_address}`);
      console.log(`   Sig: ${trade.signature.substring(0, 20)}...`);
    });

    // 6. Get unique tokens traded on AMM
    const uniqueTokensResult = await pool.query(`
      SELECT COUNT(DISTINCT mint_address) as unique_tokens
      FROM trades_unified
      WHERE program = 'amm_pool'
    `);
    const uniqueTokens = parseInt(uniqueTokensResult.rows[0].unique_tokens);
    console.log(`\n📊 Unique tokens traded on AMM: ${uniqueTokens.toLocaleString()}`);

    // 7. Check for graduated tokens with AMM trades
    const graduatedResult = await pool.query(`
      SELECT 
        tk.symbol,
        tk.name,
        tk.graduated_to_amm,
        tk.graduation_at,
        COUNT(t.id) as trade_count,
        MAX(t.created_at) as last_trade
      FROM tokens_unified tk
      INNER JOIN trades_unified t ON tk.mint_address = t.mint_address
      WHERE t.program = 'amm_pool'
      AND tk.graduated_to_amm = true
      GROUP BY tk.mint_address, tk.symbol, tk.name, tk.graduated_to_amm, tk.graduation_at
      ORDER BY trade_count DESC
      LIMIT 10
    `);

    console.log('\n🎓 Top graduated tokens by AMM trade count:');
    graduatedResult.rows.forEach((token, index) => {
      const lastTrade = format(new Date(token.last_trade), 'yyyy-MM-dd HH:mm:ss');
      console.log(`${index + 1}. ${token.symbol} - ${token.trade_count} trades - Last: ${lastTrade}`);
    });

    // 8. Check latest AMM trade timestamp
    const latestResult = await pool.query(`
      SELECT MAX(created_at) as latest_trade
      FROM trades_unified
      WHERE program = 'amm_pool'
    `);
    
    if (latestResult.rows[0].latest_trade) {
      const latestTime = new Date(latestResult.rows[0].latest_trade);
      const secondsAgo = Math.floor((Date.now() - latestTime.getTime()) / 1000);
      console.log(`\n⏰ Latest AMM trade: ${format(latestTime, 'yyyy-MM-dd HH:mm:ss')} (${secondsAgo}s ago)`);
      
      if (secondsAgo > 300) {
        console.log('⚠️  WARNING: No AMM trades in last 5 minutes - monitor may not be running!');
      } else if (secondsAgo > 60) {
        console.log('⚠️  WARNING: No AMM trades in last minute - possible issue');
      } else {
        console.log('✅ AMM trades are being inserted in real-time');
      }
    } else {
      console.log('\n❌ No AMM trades found in database!');
    }

    // 9. Compare BC vs AMM trade volumes
    const comparisonResult = await pool.query(`
      SELECT 
        program,
        COUNT(*) as trade_count,
        COUNT(DISTINCT mint_address) as unique_tokens
      FROM trades_unified
      WHERE created_at >= NOW() - INTERVAL '1 hour'
      GROUP BY program
    `);

    console.log('\n📊 Trade comparison (last hour):');
    comparisonResult.rows.forEach(row => {
      console.log(`${row.program}: ${row.trade_count} trades across ${row.unique_tokens} tokens`);
    });

  } catch (error) {
    console.error('❌ Error checking AMM trades:', error);
  } finally {
    await pool.end();
  }
}

// Run the check
checkAMMTrades().catch(console.error);