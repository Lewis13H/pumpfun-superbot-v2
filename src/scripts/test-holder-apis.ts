#!/usr/bin/env npx tsx
/**
 * Test Holder APIs
 * 
 * Test different approaches for getting token holder data
 */

import 'dotenv/config';
import chalk from 'chalk';
import axios from 'axios';
import { Connection, PublicKey } from '@solana/web3.js';

async function testHolderAPIs() {
  console.log(chalk.cyan('\n🔍 Testing Token Holder Data APIs\n'));
  
  // Test token - MINTR which we know works
  const testToken = 'CEVXFsZe9r2qzZfX7AJn9W9mWM5eu9jHaALo5NjBpump';
  
  // 1. Test Shyft API
  console.log(chalk.yellow('1. Testing Shyft API...'));
  if (process.env.SHYFT_API_KEY) {
    try {
      // Try the current endpoint
      console.log(chalk.gray('   Testing /sol/v1/token/holders...'));
      const response1 = await axios.get('https://api.shyft.to/sol/v1/token/holders', {
        headers: {
          'x-api-key': process.env.SHYFT_API_KEY
        },
        params: {
          network: 'mainnet-beta',
          token_address: testToken,
          page: 1,
          size: 10
        }
      }).catch(err => ({ error: err }));
      
      if ('error' in response1) {
        console.log(chalk.red(`   Failed: ${response1.error.response?.status} - ${response1.error.message}`));
      } else {
        console.log(chalk.green('   Success! Found holders'));
      }
      
      // Try alternative endpoints
      console.log(chalk.gray('   Testing /sol/v1/token/largest_accounts...'));
      const response2 = await axios.get('https://api.shyft.to/sol/v1/token/largest_accounts', {
        headers: {
          'x-api-key': process.env.SHYFT_API_KEY
        },
        params: {
          network: 'mainnet-beta',
          token: testToken,
          limit: 10
        }
      }).catch(err => ({ error: err }));
      
      if ('error' in response2) {
        console.log(chalk.red(`   Failed: ${response2.error.response?.status} - ${response2.error.message}`));
      } else {
        console.log(chalk.green('   Success! Found largest accounts'));
        if ('data' in response2 && response2.data.success) {
          console.log(chalk.gray(`   Result: ${response2.data.result?.length || 0} accounts`));
        }
      }
      
    } catch (error) {
      console.log(chalk.red('   Shyft API error:'), error.message);
    }
  } else {
    console.log(chalk.gray('   No SHYFT_API_KEY configured'));
  }
  
  // 2. Test Helius API
  console.log(chalk.yellow('\n2. Testing Helius API...'));
  if (process.env.HELIUS_API_KEY) {
    try {
      const response = await axios.post(
        `https://api.helius.xyz/v0/token-metadata?api-key=${process.env.HELIUS_API_KEY}`,
        {
          mintAccounts: [testToken],
          includeOffChain: true,
          disableCache: false
        }
      ).catch(err => ({ error: err }));
      
      if ('error' in response) {
        console.log(chalk.red(`   Metadata failed: ${response.error.response?.status} - ${response.error.message}`));
      } else {
        console.log(chalk.green('   Metadata success!'));
      }
      
      // Try holder endpoint
      console.log(chalk.gray('   Testing token holder endpoint...'));
      const holderResponse = await axios.get(
        `https://api.helius.xyz/v0/addresses/${testToken}/balances?api-key=${process.env.HELIUS_API_KEY}`
      ).catch(err => ({ error: err }));
      
      if ('error' in holderResponse) {
        console.log(chalk.red(`   Holders failed: ${holderResponse.error.response?.status} - ${holderResponse.error.message}`));
      } else {
        console.log(chalk.green('   Holders success!'));
      }
      
    } catch (error) {
      console.log(chalk.red('   Helius API error:'), error.message);
    }
  } else {
    console.log(chalk.gray('   No HELIUS_API_KEY configured'));
  }
  
  // 3. Test RPC approach
  console.log(chalk.yellow('\n3. Testing RPC Approach...'));
  try {
    const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
    const tokenMint = new PublicKey(testToken);
    
    // Get token supply
    const supply = await connection.getTokenSupply(tokenMint);
    console.log(chalk.gray(`   Token supply: ${supply.value.uiAmount} ${supply.value.decimals} decimals`));
    
    // Get largest accounts
    const largestAccounts = await connection.getTokenLargestAccounts(tokenMint);
    console.log(chalk.green(`   Success! Found ${largestAccounts.value.length} largest accounts`));
    
    // Show top 5
    console.log(chalk.gray('   Top 5 holders:'));
    for (let i = 0; i < Math.min(5, largestAccounts.value.length); i++) {
      const account = largestAccounts.value[i];
      const amount = parseInt(account.amount) / Math.pow(10, supply.value.decimals);
      const percentage = (amount / supply.value.uiAmount!) * 100;
      console.log(chalk.gray(`     ${i + 1}. ${account.address.toBase58().substring(0, 8)}... : ${amount.toFixed(2)} (${percentage.toFixed(2)}%)`));
    }
    
  } catch (error) {
    console.log(chalk.red('   RPC error:'), error.message);
  }
  
  // 4. Compare approaches
  console.log(chalk.cyan('\n📊 Summary:'));
  console.log(chalk.gray('   - Shyft API: May need different endpoint or configuration'));
  console.log(chalk.gray('   - Helius API: Good for metadata, holder data may be limited'));
  console.log(chalk.gray('   - RPC: Most reliable for largest accounts (top 20)'));
  console.log(chalk.gray('   - Note: Full holder list requires indexing service'));
  
  console.log(chalk.green('\n✅ Test complete!'));
}

// Run test
testHolderAPIs().catch(console.error);