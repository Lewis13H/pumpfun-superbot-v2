#!/usr/bin/env tsx
/**
 * Test Shyft AMM Pool Queries
 * Check what AMM pool data is available in Shyft GraphQL
 */

import 'dotenv/config';
import { ShyftGraphQLClient } from '../src/services/graphql-client';
import { db } from '../src/database';
import chalk from 'chalk';
import { gql } from 'graphql-request';

// Test different AMM pool queries
const TEST_AMM_POOL_QUERY = gql`
  query TestAmmPools($limit: Int!) {
    pump_fun_amm_Pool(limit: $limit) {
      pubkey
      quote_mint
      base_mint
      _updatedAt
    }
  }
`;

const TEST_AMM_POOL_BY_MINT = gql`
  query TestAmmPoolByMint($mint: String!) {
    pump_fun_amm_Pool(where: { quote_mint: { _eq: $mint } }) {
      pubkey
      quote_mint
      base_mint
      pool_base_token_account
      pool_quote_token_account
      lp_supply
      _updatedAt
    }
  }
`;

// Alternative: Check pump_swap tables
const TEST_PUMP_SWAP_POOLS = gql`
  query TestPumpSwapPools($limit: Int!) {
    pump_swap_LiquidityPool(limit: $limit) {
      pubkey
      tokenMint
      solMint
      baseAccount
      quoteAccount
      lpSupply
      _updatedAt
    }
  }
`;

async function main() {
  console.log(chalk.cyan.bold('🔍 Testing Shyft AMM Pool Queries'));
  console.log(chalk.gray('─'.repeat(80)));
  
  const client = ShyftGraphQLClient.getInstance();
  
  // Test 1: Check pump_fun_amm_Pool table
  console.log(chalk.yellow('\n1. Testing pump_fun_amm_Pool table...'));
  try {
    const result1 = await client.query(TEST_AMM_POOL_QUERY, { limit: 5 });
    console.log(chalk.green(`Found ${result1.pump_fun_amm_Pool?.length || 0} pools`));
    if (result1.pump_fun_amm_Pool?.length > 0) {
      console.log(chalk.gray('Sample pool:'), JSON.stringify(result1.pump_fun_amm_Pool[0], null, 2));
    }
  } catch (error) {
    console.log(chalk.red('Error:'), error.message);
  }
  
  // Test 2: Check pump_swap_LiquidityPool table
  console.log(chalk.yellow('\n2. Testing pump_swap_LiquidityPool table...'));
  try {
    const result2 = await client.query(TEST_PUMP_SWAP_POOLS, { limit: 5 });
    console.log(chalk.green(`Found ${result2.pump_swap_LiquidityPool?.length || 0} pools`));
    if (result2.pump_swap_LiquidityPool?.length > 0) {
      console.log(chalk.gray('Sample pool:'), JSON.stringify(result2.pump_swap_LiquidityPool[0], null, 2));
    }
  } catch (error) {
    console.log(chalk.red('Error:'), error.message);
  }
  
  // Test 3: Try a specific graduated token
  console.log(chalk.yellow('\n3. Testing specific graduated token...'));
  
  // Get a graduated token from our database
  const graduatedToken = await db.query(`
    SELECT mint_address
    FROM tokens_unified
    WHERE graduated_to_amm = true
    LIMIT 1
  `);
  
  if (graduatedToken.rows.length > 0) {
    const mint = graduatedToken.rows[0].mint_address;
    console.log(chalk.gray(`Testing with mint: ${mint}`));
    
    try {
      const result3 = await client.query(TEST_AMM_POOL_BY_MINT, { mint });
      console.log(chalk.green(`Found ${result3.pump_fun_amm_Pool?.length || 0} pools for this mint`));
      if (result3.pump_fun_amm_Pool?.length > 0) {
        console.log(chalk.gray('Pool data:'), JSON.stringify(result3.pump_fun_amm_Pool[0], null, 2));
      }
    } catch (error) {
      console.log(chalk.red('Error:'), error.message);
    }
  }
  
  // Test 4: Check available tables in schema
  console.log(chalk.yellow('\n4. Checking schema for AMM-related tables...'));
  const SCHEMA_QUERY = gql`
    query GetSchema {
      __schema {
        types {
          name
          kind
        }
      }
    }
  `;
  
  try {
    const schema = await client.query(SCHEMA_QUERY, {});
    const ammTables = schema.__schema.types
      .filter(t => t.kind === 'OBJECT' && (t.name.includes('amm') || t.name.includes('AMM') || t.name.includes('swap')))
      .map(t => t.name);
    
    console.log(chalk.green('Found AMM-related tables:'));
    ammTables.forEach(table => console.log(chalk.gray(`  - ${table}`)));
  } catch (error) {
    console.log(chalk.red('Error getting schema:'), error.message);
  }
  
  await db.close();
}

main().catch(console.error);