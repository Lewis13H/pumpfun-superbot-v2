import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function investigateToken() {
  const mint = '95ifG7SAJfSzRSTqZ4p9KGUoZvvebxJMpR16WLHFuTr4';
  
  try {
    console.log('=== Investigating BC Progress Display Issue ===\n');
    
    // 1. Check token data
    const tokenResult = await pool.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        latest_bonding_curve_progress,
        bonding_curve_complete,
        graduated_to_amm,
        latest_virtual_sol_reserves,
        latest_virtual_token_reserves,
        latest_price_sol,
        latest_market_cap_usd,
        threshold_crossed_at,
        created_at,
        updated_at
      FROM tokens_unified
      WHERE mint_address = $1
    `, [mint]);
    
    if (tokenResult.rows.length === 0) {
      console.log('Token not found');
      return;
    }
    
    const token = tokenResult.rows[0];
    console.log('Token Data:');
    console.log(`- Symbol: ${token.symbol}`);
    console.log(`- Name: ${token.name}`);
    console.log(`- BC Progress (DB): ${token.latest_bonding_curve_progress}%`);
    console.log(`- BC Complete: ${token.bonding_curve_complete}`);
    console.log(`- Graduated to AMM: ${token.graduated_to_amm}`);
    console.log(`- Virtual SOL Reserves: ${token.latest_virtual_sol_reserves}`);
    console.log(`- Market Cap: $${token.latest_market_cap_usd}`);
    
    // 2. Calculate actual progress from reserves
    if (token.latest_virtual_sol_reserves) {
      const LAMPORTS_PER_SOL = 1_000_000_000;
      const GRADUATION_SOL_TARGET = 84;
      
      const solInCurve = Number(token.latest_virtual_sol_reserves) / LAMPORTS_PER_SOL;
      const actualProgress = (solInCurve / GRADUATION_SOL_TARGET) * 100;
      const cappedProgress = Math.min(actualProgress, 100);
      
      console.log('\nProgress Calculation:');
      console.log(`- SOL in curve: ${solInCurve.toFixed(4)} SOL`);
      console.log(`- Actual progress: ${actualProgress.toFixed(2)}%`);
      console.log(`- Capped progress: ${cappedProgress.toFixed(2)}%`);
      console.log(`- Stored in DB: ${token.latest_bonding_curve_progress}%`);
      
      if (actualProgress > 100) {
        console.log('\n⚠️  WARNING: Token has more than 84 SOL but hasn\'t graduated!');
        console.log(`   This causes the dashboard to show 100% when it\'s actually ${actualProgress.toFixed(2)}%`);
      }
    }
    
    // 3. Check recent trades for this token
    const tradesResult = await pool.query(`
      SELECT 
        signature,
        program,
        bonding_curve_progress,
        virtual_sol_reserves,
        block_time
      FROM trades_unified
      WHERE mint_address = $1
      ORDER BY block_time DESC
      LIMIT 5
    `, [mint]);
    
    console.log('\nRecent Trades:');
    tradesResult.rows.forEach((trade, index) => {
      console.log(`\nTrade #${index + 1}:`);
      console.log(`- Time: ${trade.block_time}`);
      console.log(`- Program: ${trade.program}`);
      console.log(`- BC Progress: ${trade.bonding_curve_progress || 'NULL'}%`);
      if (trade.virtual_sol_reserves) {
        const sol = Number(trade.virtual_sol_reserves) / 1_000_000_000;
        console.log(`- SOL Reserves: ${sol.toFixed(4)} SOL`);
      }
    });
    
    // 4. How it displays on dashboard
    console.log('\n=== Dashboard Display Logic ===');
    const progress = parseFloat(token.latest_bonding_curve_progress) || 0;
    const isGraduated = token.graduated_to_amm;
    const bcComplete = token.bonding_curve_complete;
    
    console.log('\nIn token list (app.js line 362):');
    console.log(`Display: "${isGraduated ? 'AMM' : bcComplete ? 'BC COMPLETE' : `PUMP ${progress.toFixed(0)}%`}"`);
    console.log(`Result: "PUMP ${progress.toFixed(0)}%"`);
    
    console.log('\nIn progress bar (app.js line 386):');
    console.log(`Display: "${isGraduated ? 'GRAD' : bcComplete ? 'COMPLETE' : progress >= 100 ? '~100%' : `${progress.toFixed(0)}%`}"`);
    console.log(`Result: "${progress >= 100 ? '~100%' : `${progress.toFixed(0)}%`}"`);
    
    console.log('\n=== Summary ===');
    console.log('The issue is that the BC progress calculation is capped at 100% in multiple places:');
    console.log('1. BondingCurveAccountHandler line 135: Math.min(..., 100)');
    console.log('2. PriceCalculator line 130: Math.min(progress, 100)');
    console.log('3. TokenLifecycleMonitor: Math.min(progress, 100)');
    console.log('\nThis causes tokens with >84 SOL to show 100% progress even if not graduated.');
    console.log('The dashboard correctly displays what\'s in the database (100.00%).');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

investigateToken();