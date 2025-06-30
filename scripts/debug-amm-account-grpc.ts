#!/usr/bin/env tsx
/**
 * Debug AMM Account Monitor gRPC Subscription
 * Tests the gRPC subscription format for AMM account monitoring
 */

import 'dotenv/config';
import chalk from 'chalk';
import Client from '@triton-one/yellowstone-grpc';

async function debugGrpcSubscription() {
  console.log(chalk.cyan('Testing AMM Account Monitor gRPC Subscription\n'));
  
  const endpoint = process.env.SHYFT_GRPC_ENDPOINT || '';
  const token = process.env.SHYFT_GRPC_TOKEN || '';
  const ammProgramId = '5ujNfinc35pKNg6VaB5cJt1iBa2xFRJQCJ9dnyBsriKN';
  
  console.log('Configuration:');
  console.log(`  Endpoint: ${endpoint}`);
  console.log(`  Token: ${token.substring(0, 8)}...`);
  console.log(`  AMM Program: ${ammProgramId}\n`);
  
  try {
    // Create client
    const client = new Client(endpoint, token, {
      'grpc.keepalive_time_ms': 30000,
      'grpc.keepalive_timeout_ms': 5000,
      'grpc.keepalive_permit_without_calls': 1
    });
    
    // Test 1: Basic subscription format
    console.log('Test 1: Basic subscription format');
    const basicRequest = {
      accounts: {
        client: {
          account: [],
          owner: [ammProgramId],
          filters: []
        }
      },
      commitment: 'confirmed'
    };
    console.log('Request:', JSON.stringify(basicRequest, null, 2));
    
    // Test 2: Alternative format (with accounts map)
    console.log('\nTest 2: Alternative subscription format');
    const altRequest = {
      accounts: {
        amm_accounts: {
          account: [],
          owner: [ammProgramId],
          filters: []
        }
      },
      commitment: 'confirmed'
    };
    console.log('Request:', JSON.stringify(altRequest, null, 2));
    
    // Test 3: Try subscribing with basic format
    console.log('\nTest 3: Attempting subscription...');
    const stream = await client.subscribe();
    
    // Try writing the request
    await new Promise<void>((resolve, reject) => {
      stream.write(basicRequest, (err: any) => {
        if (err) {
          console.error(chalk.red('Write error:'), err);
          reject(err);
        } else {
          console.log(chalk.green('✓ Write successful'));
          resolve();
        }
      });
    });
    
    // Listen for data
    console.log('\nListening for account updates (10 seconds)...');
    let updateCount = 0;
    
    stream.on('data', (data: any) => {
      updateCount++;
      console.log(`Account update #${updateCount}:`, {
        slot: data.slot,
        hasAccount: !!data.account,
        accountKey: data.account?.account?.pubkey
      });
    });
    
    stream.on('error', (err: any) => {
      console.error(chalk.red('Stream error:'), err);
    });
    
    // Wait 10 seconds
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    stream.end();
    console.log(`\nReceived ${updateCount} updates`);
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  }
  
  process.exit(0);
}

debugGrpcSubscription();