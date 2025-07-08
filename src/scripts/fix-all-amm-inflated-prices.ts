#!/usr/bin/env npx tsx

import 'dotenv/config';
import { Pool } from 'pg';
import { Connection, PublicKey } from '@solana/web3.js';
import chalk from 'chalk';
import { PriceCalculator } from '../services/pricing/price-calculator';
import { EventBus } from '../core/event-bus';
import { AmmReservesFetcher } from '../services/amm/amm-reserves-fetcher';

async function fixAllAMMInflatedPrices() {
  console.log(chalk.cyan('🔧 Fixing all AMM tokens with inflated prices...\n'));
  
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const connection = new Connection(process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com');
  const priceCalculator = new PriceCalculator();
  const eventBus = new EventBus();
  const reservesFetcher = AmmReservesFetcher.getInstance(eventBus);
  
  try {
    // Get current SOL price
    const solPrice = 190; // Update this to current SOL price if needed
    console.log(chalk.yellow(`Using SOL price: $${solPrice}\n`));
    
    // Get all AMM tokens with suspiciously high market caps
    const result = await pool.query(`
      SELECT 
        t.mint_address, 
        t.symbol, 
        t.name,
        t.supply,
        t.total_supply,
        t.decimals,
        t.latest_price_usd as current_price_usd,
        t.latest_market_cap_usd as current_market_cap_usd,
        t.latest_virtual_sol_reserves,
        t.latest_virtual_token_reserves,
        t.creator
      FROM tokens_unified t
      WHERE t.graduated_to_amm = true 
        AND t.latest_market_cap_usd > 1000000  -- More than $1M (likely inflated)
      ORDER BY t.latest_market_cap_usd DESC
    `);
    
    console.log(chalk.yellow(`Found ${result.rows.length} AMM tokens with market cap > $1M\n`));
    
    let fixed = 0;
    let failed = 0;
    let skipped = 0;
    const fixes = [];
    
    for (let i = 0; i < result.rows.length; i++) {
      const token = result.rows[i];
      const progress = `[${i + 1}/${result.rows.length}]`;
      
      console.log(chalk.cyan(`${progress} Processing ${token.symbol || 'Unknown'} (${token.mint_address.substring(0, 8)}...)`));
      console.log(chalk.gray(`  Current Market Cap: $${(token.current_market_cap_usd / 1e6).toFixed(2)}M`));
      
      try {
        // First try to use existing reserves if available
        let solReserves = token.latest_virtual_sol_reserves;
        let tokenReserves = token.latest_virtual_token_reserves;
        let reservesSource = 'database';
        
        // If no reserves in DB, fetch them
        if (!solReserves || !tokenReserves) {
          console.log(chalk.yellow('  ⏳ Fetching reserves from blockchain...'));
          const reserveData = await reservesFetcher.fetchReservesForToken(token.mint_address);
          
          if (!reserveData) {
            console.log(chalk.red('  ❌ Failed to fetch reserves'));
            failed++;
            continue;
          }
          
          solReserves = reserveData.solReserves;
          tokenReserves = reserveData.tokenReserves;
          reservesSource = 'fetched';
        }
        
        // Get token decimals from blockchain if not in DB
        let decimals = token.decimals;
        if (!decimals) {
          const mintPubkey = new PublicKey(token.mint_address);
          const mintInfo = await connection.getAccountInfo(mintPubkey);
          if (mintInfo) {
            decimals = mintInfo.data[44];
          } else {
            decimals = 6; // Default to 6
          }
        }
        
        // Calculate correct price using the new method
        const priceInfo = priceCalculator.calculatePrice(
          {
            solReserves: BigInt(solReserves),
            tokenReserves: BigInt(tokenReserves),
            isVirtual: true
          },
          solPrice,
          true // isAmmToken = true
        );
        
        const oldMarketCap = Number(token.current_market_cap_usd);
        const newMarketCap = priceInfo.marketCapUsd;
        const reduction = oldMarketCap / newMarketCap;
        
        // Only update if the reduction is significant (more than 2x)
        if (reduction > 2) {
          // Calculate circulating supply (tokens in pool)
          const circulatingSupply = Number(tokenReserves) / Math.pow(10, decimals);
          
          console.log(chalk.green(`  ✅ Fixed! New market cap: $${(newMarketCap / 1000).toFixed(0)}K (${reduction.toFixed(1)}x reduction)`));
          console.log(chalk.gray(`     Reserves source: ${reservesSource}`));
          console.log(chalk.gray(`     Circulating supply: ${circulatingSupply.toLocaleString()} tokens`));
          
          // Update database
          await pool.query(`
            UPDATE tokens_unified 
            SET 
              supply = $2,
              decimals = $3,
              latest_price_usd = $4,
              latest_market_cap_usd = $5,
              latest_virtual_sol_reserves = $6,
              latest_virtual_token_reserves = $7,
              updated_at = NOW()
            WHERE mint_address = $1
          `, [
            token.mint_address,
            circulatingSupply.toString(),
            decimals,
            priceInfo.priceInUsd,
            newMarketCap,
            solReserves.toString(),
            tokenReserves.toString()
          ]);
          
          fixes.push({
            symbol: token.symbol || 'Unknown',
            mint: token.mint_address,
            oldMarketCap,
            newMarketCap,
            reduction
          });
          
          fixed++;
        } else {
          console.log(chalk.gray(`  ⏭️  Skipped - reduction only ${reduction.toFixed(1)}x`));
          skipped++;
        }
        
        // Add delay to avoid rate limiting
        if (reservesSource === 'fetched') {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
      } catch (error) {
        console.log(chalk.red(`  ❌ Error: ${error.message}`));
        failed++;
      }
    }
    
    // Summary
    console.log(chalk.cyan('\n\n📊 Summary:'));
    console.log(chalk.green(`✅ Fixed: ${fixed} tokens`));
    console.log(chalk.yellow(`⏭️  Skipped: ${skipped} tokens (already reasonable)`));
    console.log(chalk.red(`❌ Failed: ${failed} tokens`));
    
    if (fixes.length > 0) {
      console.log(chalk.cyan('\n📈 Top 10 Fixes:'));
      fixes
        .sort((a, b) => b.reduction - a.reduction)
        .slice(0, 10)
        .forEach((fix, i) => {
          console.log(chalk.white(
            `  ${i + 1}. ${fix.symbol} (${fix.mint.substring(0, 8)}...): ` +
            `$${(fix.oldMarketCap / 1e6).toFixed(1)}M → $${(fix.newMarketCap / 1000).toFixed(0)}K ` +
            `(${fix.reduction.toFixed(0)}x reduction)`
          ));
        });
    }
    
    // Also update recent trades to reflect new market caps
    if (fixed > 0) {
      console.log(chalk.yellow('\n🔄 Updating recent trades...'));
      
      const updateResult = await pool.query(`
        UPDATE trades_unified t
        SET 
          market_cap_usd = tok.latest_market_cap_usd,
          price_usd = tok.latest_price_usd
        FROM tokens_unified tok
        WHERE t.mint_address = tok.mint_address
          AND t.program = 'amm_pool'
          AND t.block_time > NOW() - INTERVAL '24 hours'
          AND tok.graduated_to_amm = true
          AND tok.latest_market_cap_usd < 1000000
      `);
      
      console.log(chalk.green(`✅ Updated ${updateResult.rowCount} recent trades`));
    }
    
    console.log(chalk.cyan('\n✨ Complete! AMM token prices have been fixed.'));
    
  } catch (error) {
    console.error(chalk.red('Fatal error:'), error);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

// Run the fix
fixAllAMMInflatedPrices().catch(console.error);