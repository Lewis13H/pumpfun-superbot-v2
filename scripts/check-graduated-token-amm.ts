#!/usr/bin/env tsx
/**
 * Check if graduated tokens have AMM pools
 */

import 'dotenv/config';
import { ShyftGraphQLClient } from '../src/services/graphql-client';
import { db } from '../src/database';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold('Checking Graduated Tokens AMM Pools...\n'));
  
  const client = ShyftGraphQLClient.getInstance();
  
  try {
    // Get graduated tokens
    const graduatedTokens = await db.query(`
      SELECT 
        mint_address,
        symbol,
        name,
        latest_market_cap_usd
      FROM tokens_unified
      WHERE graduated_to_amm = true
      ORDER BY latest_market_cap_usd DESC
      LIMIT 10
    `);
    
    console.log(chalk.yellow(`Found ${graduatedTokens.rows.length} graduated tokens\n`));
    
    // Check each token for AMM pool
    for (const token of graduatedTokens.rows) {
      console.log(chalk.white(`Checking ${token.symbol || 'Unknown'} (${token.mint_address.slice(0, 8)}...):`));
      
      try {
        // Query for AMM pool
        const query = `
          query GetPoolForToken($mint: String!) {
            pump_fun_amm_Pool(
              where: {
                quote_mint: { _eq: $mint }
              }
            ) {
              pubkey
              base_mint
              quote_mint
              lp_supply
              _updatedAt
            }
          }
        `;
        
        const result = await client.query(query, { mint: token.mint_address });
        
        if (result.pump_fun_amm_Pool?.length > 0) {
          const pool = result.pump_fun_amm_Pool[0];
          console.log(chalk.green(`  ✅ Found AMM pool: ${pool.pubkey}`));
          console.log(chalk.gray(`     LP Supply: ${pool.lp_supply}`));
          console.log(chalk.gray(`     Updated: ${pool._updatedAt}`));
        } else {
          console.log(chalk.red(`  ❌ No AMM pool found`));
        }
      } catch (error) {
        console.log(chalk.red(`  ❌ Error: ${error.message}`));
      }
    }
    
    // Check if there are any AMM pools at all
    console.log(chalk.yellow('\n\nChecking total AMM pools...'));
    const poolCountQuery = `
      query CountPools {
        pump_fun_amm_Pool_aggregate {
          aggregate {
            count
          }
        }
        
        recent_pools: pump_fun_amm_Pool(
          order_by: { _updatedAt: desc }
          limit: 5
        ) {
          pubkey
          quote_mint
          _updatedAt
        }
      }
    `;
    
    const countResult = await client.query(poolCountQuery, {});
    console.log(chalk.blue(`Total AMM pools: ${countResult.pump_fun_amm_Pool_aggregate?.aggregate?.count || 0}`));
    
    if (countResult.recent_pools?.length > 0) {
      console.log(chalk.gray('\nRecent pools:'));
      countResult.recent_pools.forEach(pool => {
        console.log(chalk.gray(`  ${pool.pubkey.slice(0, 8)}... - Token: ${pool.quote_mint.slice(0, 8)}... - ${pool._updatedAt}`));
      });
    }
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await db.close();
  }
}

main().catch(console.error);