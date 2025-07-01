#!/usr/bin/env node

/**
 * Test GraphQL queries for pump.fun data
 */

const fetch = require('node-fetch');
const chalk = require('chalk');

const GRAPHQL_ENDPOINT = `https://programs.shyft.to/v0/graphql/?api_key=3M9B3EeJTk_1EAuG&network=mainnet-beta`;

async function testGraphQLQueries() {
  console.log(chalk.blue('🧪 Testing pump.fun GraphQL queries...\n'));
  
  // Test token to query (you can change this to any pump.fun token)
  const testMint = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr'; // POPCAT
  
  try {
    // Test bonding curve query
    console.log(chalk.yellow('📊 Testing bonding curve query...'));
    const bcQuery = `
      query GetBondingCurveData($mints: [String!]!) {
        pump_BondingCurve(
          where: { tokenMint: { _in: $mints } }
        ) {
          tokenMint
          virtualTokenReserves
          virtualSolReserves
          realTokenReserves
          realSolReserves
          tokenTotalSupply
          complete
          creator
          pubkey
          _updatedAt
        }
      }
    `;
    
    const bcResponse = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: bcQuery,
        variables: { mints: [testMint] }
      })
    });
    
    const bcData = await bcResponse.json();
    
    if (bcData.data && bcData.data.pump_BondingCurve) {
      console.log(chalk.green('✅ Bonding curve query successful!'));
      const bc = bcData.data.pump_BondingCurve[0];
      if (bc) {
        console.log(chalk.gray(`  - Token: ${bc.tokenMint}`));
        console.log(chalk.gray(`  - Creator: ${bc.creator}`));
        console.log(chalk.gray(`  - Total Supply: ${bc.tokenTotalSupply}`));
        console.log(chalk.gray(`  - Complete: ${bc.complete}`));
        console.log(chalk.gray(`  - BC Key: ${bc.pubkey}`));
      } else {
        console.log(chalk.yellow('  ⚠️  No bonding curve data found for this token'));
      }
    } else {
      console.log(chalk.red('❌ Bonding curve query failed'));
      console.log(JSON.stringify(bcData, null, 2));
    }
    
    // Test recent bonding curves
    console.log(chalk.yellow('\n📊 Testing recent bonding curves query...'));
    const recentQuery = `
      query GetRecentBondingCurves {
        pump_BondingCurve(
          limit: 5
          order_by: { _createdAt: desc }
        ) {
          tokenMint
          creator
          tokenTotalSupply
          complete
          _createdAt
        }
      }
    `;
    
    const recentResponse = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: recentQuery
      })
    });
    
    const recentData = await recentResponse.json();
    
    if (recentData.data && recentData.data.pump_BondingCurve) {
      console.log(chalk.green(`✅ Found ${recentData.data.pump_BondingCurve.length} recent bonding curves:`));
      recentData.data.pump_BondingCurve.forEach((bc, i) => {
        console.log(chalk.cyan(`\n  ${i + 1}. ${bc.tokenMint}`));
        console.log(chalk.gray(`     Creator: ${bc.creator}`));
        console.log(chalk.gray(`     Supply: ${bc.tokenTotalSupply}`));
        console.log(chalk.gray(`     Complete: ${bc.complete}`));
        console.log(chalk.gray(`     Created: ${bc._createdAt}`));
      });
    } else {
      console.log(chalk.red('❌ Recent bonding curves query failed'));
      console.log(JSON.stringify(recentData, null, 2));
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Error:'), error.message);
  }
}

// Run test
testGraphQLQueries().catch(console.error);