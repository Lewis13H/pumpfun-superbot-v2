/**
 * Test Trading Activity Monitor AMM Detection
 * Directly tests if the monitor is receiving AMM transactions
 */

import * as dotenv from 'dotenv';
dotenv.config();

import Client, { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import bs58 from 'bs58';

const AMM_PROGRAM_ID = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';

async function testAmmDetection() {
  console.log('🔍 Testing AMM Transaction Detection\n');
  
  let client: Client | null = null;
  let stream: any = null;
  
  const cleanup = async () => {
    try {
      if (stream) {
        stream.end();
        stream.removeAllListeners();
      }
      if (client) {
        client.close();
      }
    } catch (e) {
      // Ignore
    }
  };
  
  try {
    client = new Client(
      process.env.SHYFT_GRPC_ENDPOINT!,
      process.env.SHYFT_GRPC_TOKEN!,
      undefined
    );
    
    stream = await client.subscribe();
    
    let totalTxns = 0;
    let ammTxns = 0;
    const startTime = Date.now();
    
    stream.on('data', (data: any) => {
      if (data?.transaction) {
        totalTxns++;
        
        const tx = data.transaction?.transaction || data.transaction;
        const accounts = tx?.transaction?.message?.accountKeys || tx?.message?.accountKeys || [];
        
        const accountStrs = accounts.map((acc: any) => {
          if (typeof acc === 'string') return acc;
          if (acc instanceof Uint8Array || acc instanceof Buffer) return bs58.encode(acc);
          return String(acc);
        });
        
        if (accountStrs.includes(AMM_PROGRAM_ID)) {
          ammTxns++;
          
          const signature = data.transaction?.signature || 
                           (tx?.transaction?.signatures?.[0] && bs58.encode(tx.transaction.signatures[0])) ||
                           'unknown';
          
          console.log(`✅ AMM Transaction #${ammTxns}`);
          console.log(`   Signature: ${signature}`);
          console.log(`   Accounts: ${accountStrs.length}`);
          
          // Check for instructions
          const instructions = tx?.transaction?.message?.compiledInstructions || 
                             tx?.message?.compiledInstructions || [];
          console.log(`   Instructions: ${instructions.length}`);
          
          // Check for inner instructions
          const innerIx = tx?.meta?.innerInstructions || [];
          console.log(`   Inner Instructions: ${innerIx.length}`);
          
          // Show first few accounts
          console.log(`   Key Accounts:`);
          accountStrs.slice(0, 5).forEach((acc, i) => {
            console.log(`     ${i}: ${acc.slice(0, 16)}...`);
          });
          console.log('');
          
          if (ammTxns >= 5) {
            console.log('✅ AMM transactions are being received!');
            console.log('\nThe issue is likely in the parsing or saving logic.');
            cleanup();
            process.exit(0);
          }
        }
        
        // Progress
        if (totalTxns % 100 === 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          console.log(`Processed ${totalTxns} transactions in ${elapsed.toFixed(1)}s (${ammTxns} AMM)...`);
        }
      }
    });
    
    stream.on('error', (error: any) => {
      console.error('Stream error:', error.message || error);
      cleanup();
      process.exit(1);
    });
    
    // Subscribe to ALL transactions
    const request = {
      accounts: {},
      slots: {},
      transactions: {
        all: {
          vote: false,
          failed: false,
          accountInclude: [],
          accountExclude: [],
          accountRequired: []
        }
      },
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      commitment: CommitmentLevel.CONFIRMED
    };
    
    await new Promise((resolve, reject) => {
      stream.write(request, (err: any) => {
        if (err) {
          reject(err);
        } else {
          console.log('✅ Subscribed to ALL transactions\n');
          console.log('Looking for AMM transactions...\n');
          resolve(true);
        }
      });
    });
    
    // Timeout after 30 seconds
    setTimeout(async () => {
      console.log(`\n⏱️  Timeout reached`);
      console.log(`Total transactions: ${totalTxns}`);
      console.log(`AMM transactions: ${ammTxns}`);
      
      if (ammTxns === 0) {
        console.log('\n❌ No AMM transactions detected!');
        console.log('Possible issues:');
        console.log('- Low AMM activity at this time');
        console.log('- Connection issues');
        console.log('- Rate limiting');
      }
      
      await cleanup();
      process.exit(0);
    }, 30000);
    
  } catch (error) {
    console.error('Error:', error);
    await cleanup();
    process.exit(1);
  }
}

testAmmDetection().catch(console.error);