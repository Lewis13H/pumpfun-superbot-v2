#!/usr/bin/env tsx

/**
 * Test bonding curve address derivation
 */

import 'dotenv/config';
import { GraphQLClient } from 'graphql-request';
import { gql } from 'graphql-request';
import { deriveBondingCurveAddress } from '../utils/pump-addresses';
import chalk from 'chalk';

const GRAPHQL_ENDPOINT = `https://programs.shyft.to/v0/graphql/?api_key=${process.env.SHYFT_API_KEY}&network=mainnet-beta`;

const client = new GraphQLClient(GRAPHQL_ENDPOINT, {
  headers: {
    'Content-Type': 'application/json',
  },
});

// Query by pubkey
const QUERY_BY_PUBKEY = gql`
  query GetBondingCurve($pubkey: String!) {
    pump_BondingCurve(
      where: {
        pubkey: { _eq: $pubkey }
      }
    ) {
      pubkey
      virtualSolReserves
      virtualTokenReserves
      complete
      _updatedAt
    }
  }
`;

async function testBondingCurveAddress() {
  console.log(chalk.cyan.bold('\n🧪 Testing Bonding Curve Address Derivation\n'));
  
  try {
    // Test token
    const tokenMint = '3aoJGDLTq9SLNbGugxTkzQtdTUugq8tocQXtEmVUpump';
    
    // Derive bonding curve address
    const bondingCurveAddress = deriveBondingCurveAddress(tokenMint);
    console.log(chalk.blue('Token Mint:'), tokenMint);
    console.log(chalk.blue('Derived Bonding Curve:'), bondingCurveAddress.toBase58());
    
    // Query GraphQL with derived address
    console.log(chalk.gray('\nQuerying GraphQL...'));
    const result = await client.request(QUERY_BY_PUBKEY, { 
      pubkey: bondingCurveAddress.toBase58() 
    });
    
    if (result.pump_BondingCurve && result.pump_BondingCurve.length > 0) {
      console.log(chalk.green('\n✅ Found bonding curve!'));
      const bc = result.pump_BondingCurve[0];
      console.log(chalk.gray('Data:'));
      console.log(`  Virtual SOL: ${bc.virtualSolReserves}`);
      console.log(`  Virtual Tokens: ${bc.virtualTokenReserves}`);
      console.log(`  Complete: ${bc.complete}`);
      console.log(`  Updated: ${bc._updatedAt}`);
      
      // Calculate price
      const solReserves = BigInt(bc.virtualSolReserves);
      const tokenReserves = BigInt(bc.virtualTokenReserves);
      const priceInLamports = solReserves * BigInt(1e6) / tokenReserves;
      const priceInSol = Number(priceInLamports) / 1e9;
      console.log(`  Price: ${priceInSol.toFixed(9)} SOL per token`);
    } else {
      console.log(chalk.red('\n❌ No bonding curve found'));
    }
    
  } catch (error: any) {
    console.error(chalk.red('\n❌ Test failed:'));
    console.error(error.response || error);
  }
}

// Run test
testBondingCurveAddress()
  .then(() => {
    console.log(chalk.green('\n✅ Test complete'));
    process.exit(0);
  })
  .catch(error => {
    console.error(chalk.red('\n❌ Test failed:'), error);
    process.exit(1);
  });