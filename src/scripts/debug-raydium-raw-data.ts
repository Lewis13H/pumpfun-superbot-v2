/**
 * Debug script to analyze raw Raydium transaction data
 * Helps understand the exact data structure from gRPC
 */

import * as dotenv from 'dotenv';
import Client, { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';

dotenv.config();

const RAYDIUM_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

async function debugRawData() {
  const endpoint = process.env.SHYFT_GRPC_ENDPOINT;
  const token = process.env.SHYFT_GRPC_TOKEN;
  
  if (!endpoint || !token) {
    console.error('Missing SHYFT_GRPC_ENDPOINT or SHYFT_GRPC_TOKEN');
    process.exit(1);
  }

  console.log('Connecting to gRPC endpoint...');
  const client = new Client(endpoint, token, {
    timeout: 600000,
    keepaliveTime: 30000,
    keepaliveTimeout: 5000
  });

  console.log('Setting up subscription for Raydium transactions...');
  
  // Track unique data paths
  const dataPaths = new Set<string>();
  let transactionCount = 0;
  let raydiumCount = 0;

  // Subscribe to all transactions first to see structure
  const stream = await client.subscribe();

  // Configure the subscription
  const request = {
    commitment: CommitmentLevel.CONFIRMED,
    accounts: {},
    slots: {},
    transactions: {
      client: {
        vote: false,
        failed: false,
        accountInclude: [],
        accountExclude: [],
        accountRequired: []
      }
    },
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    accountsDataSlice: [],
    ping: undefined,
    entry: {}
  };

  // Send subscription request
  await new Promise<void>((resolve, reject) => {
    stream.write(request, (err: any) => {
      if (err === null || err === undefined) {
        console.log('Connected to stream');
        resolve();
      } else {
        reject(err);
      }
    });
  });

  stream.on('data', (data: any) => {
    transactionCount++;
    
    // Explore data structure
    const paths: string[] = [];
    function explorePaths(obj: any, path: string = '') {
      if (!obj || typeof obj !== 'object') return;
      
      for (const key in obj) {
        const fullPath = path ? `${path}.${key}` : key;
        paths.push(fullPath);
        
        if (key === 'transaction' || key === 'meta' || key === 'message') {
          explorePaths(obj[key], fullPath);
        }
      }
    }
    
    explorePaths(data);
    paths.forEach(p => dataPaths.add(p));
    
    // Check various locations for transaction data
    const possibleTxPaths = [
      data?.transaction,
      data?.transaction?.transaction,
      data?.transactions,
      data?.data?.transaction,
    ];
    
    let actualTx = null;
    let txPath = '';
    
    for (let i = 0; i < possibleTxPaths.length; i++) {
      if (possibleTxPaths[i]) {
        actualTx = possibleTxPaths[i];
        txPath = ['data.transaction', 'data.transaction.transaction', 'data.transactions', 'data.data.transaction'][i];
        break;
      }
    }
    
    if (!actualTx) {
      if (transactionCount % 1000 === 0) {
        console.log(`Processed ${transactionCount} messages, no transaction data found`);
        console.log('Current data paths:', Array.from(dataPaths).slice(0, 10));
      }
      return;
    }
    
    // Now check for Raydium
    const checkForRaydium = (tx: any): boolean => {
      // Check different possible structures
      const accountKeysPaths = [
        tx?.transaction?.message?.accountKeys,
        tx?.message?.accountKeys,
        tx?.accountKeys,
      ];
      
      for (const keys of accountKeysPaths) {
        if (keys && Array.isArray(keys)) {
          for (const key of keys) {
            let keyStr = '';
            
            // Handle different key formats
            if (typeof key === 'string') {
              keyStr = key;
            } else if (Buffer.isBuffer(key)) {
              try {
                keyStr = new PublicKey(key).toString();
              } catch {}
            } else if (key && typeof key === 'object') {
              // Base64 encoded?
              try {
                const decoded = Buffer.from(key, 'base64');
                keyStr = new PublicKey(decoded).toString();
              } catch {}
              
              // Or has pubkey property?
              if (key.pubkey) keyStr = key.pubkey;
              if (key.toString) keyStr = key.toString();
            }
            
            if (keyStr === RAYDIUM_PROGRAM_ID) {
              return true;
            }
          }
        }
      }
      
      return false;
    };
    
    if (checkForRaydium(actualTx)) {
      raydiumCount++;
      console.log('\n🎯 FOUND RAYDIUM TRANSACTION!');
      console.log(`Transaction path: ${txPath}`);
      console.log(`Total transactions seen: ${transactionCount}`);
      console.log(`Raydium transactions: ${raydiumCount}`);
      
      // Log the structure
      console.log('\nTransaction structure:');
      console.log('- Keys at transaction root:', Object.keys(actualTx));
      
      if (actualTx.transaction) {
        console.log('- Keys at transaction.transaction:', Object.keys(actualTx.transaction));
      }
      
      if (actualTx.transaction?.message || actualTx.message) {
        const msg = actualTx.transaction?.message || actualTx.message;
        console.log('- Keys at message:', Object.keys(msg));
        console.log('- Account keys count:', msg.accountKeys?.length || 0);
        console.log('- Instructions count:', msg.instructions?.length || 0);
        
        // Check account key format
        if (msg.accountKeys && msg.accountKeys.length > 0) {
          const firstKey = msg.accountKeys[0];
          console.log('\nFirst account key type:', typeof firstKey);
          if (typeof firstKey === 'object') {
            console.log('First account key is object with keys:', Object.keys(firstKey));
            console.log('Sample:', JSON.stringify(firstKey).slice(0, 100) + '...');
          }
        }
      }
      
      // Log full structure of first Raydium transaction
      if (raydiumCount === 1) {
        console.log('\nFull structure (first 500 chars):');
        console.log(JSON.stringify(actualTx, null, 2).slice(0, 500) + '...');
      }
      
      // Exit after finding a few
      if (raydiumCount >= 3) {
        console.log('\nFound enough samples. Exiting...');
        process.exit(0);
      }
    }
    
    // Progress update
    if (transactionCount % 5000 === 0) {
      console.log(`Processed ${transactionCount} transactions, found ${raydiumCount} Raydium transactions`);
    }
  });

  stream.on('error', (error: Error) => {
    console.error('Stream error:', error);
  });

  stream.on('end', () => {
    console.log('Stream ended');
  });

  // Exit after 2 minutes if no Raydium found
  setTimeout(() => {
    console.log(`\nTimeout reached. Processed ${transactionCount} transactions, found ${raydiumCount} Raydium transactions`);
    console.log('\nAll data paths found:');
    Array.from(dataPaths).sort().forEach(p => console.log(`  ${p}`));
    process.exit(0);
  }, 120000);
}

debugRawData().catch(console.error);