#!/usr/bin/env tsx
/**
 * Test unified price recovery for both graduated and non-graduated tokens
 */

import 'dotenv/config';
import { UnifiedGraphQLPriceRecovery } from '../src/services/unified-graphql-price-recovery';
import { db } from '../src/database';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('Testing Unified Price Recovery...\n'));
  
  const recovery = UnifiedGraphQLPriceRecovery.getInstance();
  
  try {
    // Test with specific graduated token
    const graduatedToken = '46dKYuQzaQGQUUwDy72qLW2gLBojv1MQB2EjTgHJpump';
    console.log(chalk.yellow('Testing graduated token:'), graduatedToken);
    
    // Get token info
    const tokenInfo = await db.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        graduated_to_amm,
        latest_market_cap_usd,
        latest_price_usd,
        updated_at
      FROM tokens_unified
      WHERE mint_address = $1
    `, [graduatedToken]);
    
    if (tokenInfo.rows.length > 0) {
      const token = tokenInfo.rows[0];
      console.log(chalk.gray(`  Symbol: ${token.symbol || 'Unknown'}`));
      console.log(chalk.gray(`  Graduated: ${token.graduated_to_amm}`));
      console.log(chalk.gray(`  Current Market Cap: $${token.latest_market_cap_usd}`));
    }
    
    // Test recovery
    console.log(chalk.blue('\nRecovering price...'));
    const result = await recovery.recoverPrices([graduatedToken]);
    
    if (result.successful.length > 0) {
      const update = result.successful[0];
      console.log(chalk.green('✅ Recovery successful!'));
      console.log(chalk.white(`  Source: ${update.source}`));
      console.log(chalk.white(`  Price: $${update.priceInUsd.toFixed(6)}`));
      console.log(chalk.white(`  Market Cap: $${update.marketCapUsd.toFixed(2)}`));
      console.log(chalk.white(`  Progress: ${update.progress}%`));
    } else if (result.failed.length > 0) {
      const failure = result.failed[0];
      console.log(chalk.red('❌ Recovery failed:'), failure.reason);
    }
    
    // Test with a mix of tokens
    console.log(chalk.yellow('\n\nTesting mix of graduated and non-graduated tokens...'));
    
    const mixedTokens = await db.query(`
      SELECT 
        mint_address,
        symbol,
        graduated_to_amm,
        latest_market_cap_usd
      FROM tokens_unified
      WHERE latest_market_cap_usd > 10000
      ORDER BY random()
      LIMIT 10
    `);
    
    if (mixedTokens.rows.length > 0) {
      const mints = mixedTokens.rows.map(r => r.mint_address);
      const graduatedCount = mixedTokens.rows.filter(r => r.graduated_to_amm).length;
      
      console.log(chalk.gray(`  Selected ${mixedTokens.rows.length} tokens (${graduatedCount} graduated)`));
      
      const mixResult = await recovery.recoverPrices(mints);
      
      console.log(chalk.green(`\n✅ Recovered ${mixResult.successful.length}/${mints.length} tokens`));
      console.log(chalk.gray(`  GraphQL queries used: ${mixResult.graphqlQueries}`));
      console.log(chalk.gray(`  Query time: ${mixResult.queryTime}ms`));
      
      // Show breakdown by source
      const bySouce = {
        graphql: mixResult.successful.filter(s => s.source === 'graphql').length,
        amm: mixResult.successful.filter(s => (s as any).source === 'amm').length,
      };
      
      console.log(chalk.blue('\nBreakdown by source:'));
      console.log(chalk.white(`  Bonding Curves: ${bySouce.graphql}`));
      console.log(chalk.white(`  AMM Pools: ${bySouce.amm}`));
      
      if (mixResult.failed.length > 0) {
        console.log(chalk.yellow(`\n⚠️ Failed recoveries: ${mixResult.failed.length}`));
        mixResult.failed.forEach(fail => {
          console.log(chalk.red(`  ${fail.mintAddress.slice(0, 8)}... - ${fail.reason}`));
        });
      }
    }
    
    // Show cache stats
    const cacheStats = recovery.getCacheStats();
    console.log(chalk.blue('\nCache statistics:'));
    console.log(chalk.gray(`  Size: ${cacheStats.size}/${cacheStats.maxSize}`));
    console.log(chalk.gray(`  TTL: ${cacheStats.ttl}s`));
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await db.close();
  }
}

main().catch(console.error);