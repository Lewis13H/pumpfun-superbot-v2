#!/usr/bin/env tsx

/**
 * Simple GraphQL test to verify connection and query structure
 */

import 'dotenv/config';
import { GraphQLClient } from 'graphql-request';
import { gql } from 'graphql-request';
import chalk from 'chalk';

const GRAPHQL_ENDPOINT = `https://programs.shyft.to/v0/graphql/?api_key=${process.env.SHYFT_API_KEY}&network=mainnet-beta`;

const client = new GraphQLClient(GRAPHQL_ENDPOINT, {
  headers: {
    'Content-Type': 'application/json',
  },
});

// Test query for a single token
const TEST_QUERY = gql`
  query TestBondingCurve($tokenMint: String!) {
    pump_BondingCurve(
      where: {
        tokenMint: { _eq: $tokenMint }
      }
      limit: 1
    ) {
      pubkey
      tokenMint
      virtualSolReserves
      virtualTokenReserves
      realSolReserves
      realTokenReserves
      tokenTotalSupply
      complete
      _updatedAt
    }
  }
`;

// Test multiple tokens
const TEST_MULTIPLE = gql`
  query TestMultiple($tokenMints: [String!]!) {
    pump_BondingCurve(
      where: {
        tokenMint: { _in: $tokenMints }
      }
    ) {
      tokenMint
      virtualSolReserves
      virtualTokenReserves
      complete
    }
  }
`;

async function testSimpleGraphQL() {
  console.log(chalk.cyan.bold('\n🧪 Testing Simple GraphQL Query\n'));
  
  try {
    // Test 1: Single token
    const testToken = '3aoJGDLTq9SLNbGugxTkzQtdTUugq8tocQXtEmVUpump';
    console.log(chalk.blue('1️⃣ Testing single token query...'));
    console.log(chalk.gray(`Token: ${testToken}`));
    
    const singleResult = await client.request(TEST_QUERY, { tokenMint: testToken });
    console.log(chalk.green('\nSuccess! Response:'));
    console.log(JSON.stringify(singleResult, null, 2));
    
    // Test 2: Multiple tokens
    const testTokens = [
      '3aoJGDLTq9SLNbGugxTkzQtdTUugq8tocQXtEmVUpump',
      '4ivWbdeom3hJi5n6STNLSdCFekj1AS9LS4QRwJScpump',
      'INVALID_TOKEN_ADDRESS' // Test with invalid token
    ];
    
    console.log(chalk.blue('\n2️⃣ Testing multiple tokens query...'));
    const multiResult = await client.request(TEST_MULTIPLE, { tokenMints: testTokens });
    console.log(chalk.green('\nSuccess! Found:'), multiResult.pump_BondingCurve.length, 'bonding curves');
    
    // Show data structure
    if (multiResult.pump_BondingCurve.length > 0) {
      const first = multiResult.pump_BondingCurve[0];
      console.log(chalk.gray('\nSample data:'));
      console.log(`  Token: ${first.tokenMint.slice(0, 8)}...`);
      console.log(`  Virtual SOL: ${first.virtualSolReserves}`);
      console.log(`  Virtual Tokens: ${first.virtualTokenReserves}`);
      console.log(`  Complete: ${first.complete}`);
      
      // Calculate price
      const solReserves = BigInt(first.virtualSolReserves);
      const tokenReserves = BigInt(first.virtualTokenReserves);
      const priceInLamports = solReserves * BigInt(1e6) / tokenReserves;
      const priceInSol = Number(priceInLamports) / 1e9;
      console.log(`  Price: ${priceInSol.toFixed(9)} SOL per token`);
    }
    
  } catch (error: any) {
    console.error(chalk.red('\n❌ Test failed:'));
    console.error(error.response || error);
  }
}

// Run test
testSimpleGraphQL()
  .then(() => {
    console.log(chalk.green('\n✅ Test complete'));
    process.exit(0);
  })
  .catch(error => {
    console.error(chalk.red('\n❌ Test failed:'), error);
    process.exit(1);
  });