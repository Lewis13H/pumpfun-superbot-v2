#!/usr/bin/env npx tsx
/**
 * Test Shyft Token Owners Endpoint
 * 
 * Verifies if Shyft has a getTokenOwners endpoint
 */

import 'dotenv/config';
import chalk from 'chalk';
import axios from 'axios';
import { ShyftTokenOwnersFetcher } from '../services/holder-analysis/shyft-token-owners-fetcher';

async function testShyftTokenOwners() {
  console.log(chalk.cyan('\n🧪 Testing Shyft Token Owners Endpoint\n'));
  
  if (!process.env.SHYFT_API_KEY) {
    console.log(chalk.red('❌ SHYFT_API_KEY not found in environment'));
    return;
  }
  
  const fetcher = new ShyftTokenOwnersFetcher();
  
  // Test tokens
  const testTokens = [
    { 
      mint: 'CEVXFsZe9r2qzZfX7AJn9W9mWM5eu9jHaALo5NjBpump', 
      symbol: 'MINTR'
    },
    { 
      mint: 'So11111111111111111111111111111111111111112', 
      symbol: 'SOL'
    }
  ];
  
  // First, let's test the endpoint directly
  console.log(chalk.yellow('1. Testing Shyft API endpoints directly...\n'));
  
  for (const token of testTokens) {
    console.log(chalk.gray(`Testing ${token.symbol} (${token.mint}):`));
    
    // Test token/info endpoint
    try {
      const infoResponse = await axios.get(
        'https://api.shyft.to/sol/v1/token/info',
        {
          headers: { 'x-api-key': process.env.SHYFT_API_KEY },
          params: {
            network: 'mainnet-beta',
            token_address: token.mint
          }
        }
      );
      
      if (infoResponse.data.success) {
        console.log(chalk.green(`   ✓ Token info endpoint works`));
        console.log(chalk.gray(`     Name: ${infoResponse.data.result?.name || 'Unknown'}`));
        console.log(chalk.gray(`     Symbol: ${infoResponse.data.result?.symbol || 'Unknown'}`));
      }
    } catch (error: any) {
      console.log(chalk.red(`   ✗ Token info failed: ${error.response?.status} ${error.response?.statusText}`));
    }
    
    // Test token/owners endpoint
    try {
      const ownersResponse = await axios.get(
        'https://api.shyft.to/sol/v1/token/owners',
        {
          headers: { 'x-api-key': process.env.SHYFT_API_KEY },
          params: {
            network: 'mainnet-beta',
            token_address: token.mint,
            limit: 10
          }
        }
      );
      
      if (ownersResponse.data.success) {
        console.log(chalk.green(`   ✓ Token owners endpoint works!`));
        console.log(chalk.gray(`     Found ${ownersResponse.data.result?.length || 0} owners`));
      }
    } catch (error: any) {
      console.log(chalk.red(`   ✗ Token owners failed: ${error.response?.status} ${error.response?.statusText}`));
      if (error.response?.data) {
        console.log(chalk.gray(`     Message: ${JSON.stringify(error.response.data)}`));
      }
    }
    
    console.log('');
  }
  
  // Test using our fetcher class
  console.log(chalk.yellow('2. Testing ShyftTokenOwnersFetcher class...\n'));
  
  for (const token of testTokens) {
    console.log(chalk.gray(`Fetching owners for ${token.symbol}:`));
    
    try {
      const startTime = Date.now();
      const result = await fetcher.fetchAllOwners(token.mint, { limit: 20 });
      const duration = Date.now() - startTime;
      
      if (result) {
        console.log(chalk.green(`   ✓ Success in ${duration}ms`));
        console.log(chalk.gray(`     Token: ${result.tokenInfo.symbol} (${result.tokenInfo.name})`));
        console.log(chalk.gray(`     Holders found: ${result.totalHolders}`));
        
        if (result.holders.length > 0) {
          console.log(chalk.gray('\n     Top 5 holders:'));
          result.holders.slice(0, 5).forEach((h, i) => {
            console.log(chalk.gray(
              `     ${i + 1}. ${h.address.substring(0, 8)}... - ${h.percentage.toFixed(2)}%`
            ));
          });
        }
      } else {
        console.log(chalk.red(`   ✗ Failed to fetch owners`));
      }
    } catch (error: any) {
      console.log(chalk.red(`   ✗ Error: ${error.message}`));
    }
    
    console.log('');
  }
  
  console.log(chalk.green('\n✅ Shyft token owners test complete!\n'));
}

// Run test
testShyftTokenOwners().catch(console.error);