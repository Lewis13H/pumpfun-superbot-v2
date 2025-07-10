/**
 * Debug AMM Subscription
 * Tests if we're receiving AMM transactions from the stream
 */

import * as dotenv from 'dotenv';
dotenv.config();

import Client, { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

const AMM_PROGRAM_ID = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const BC_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

async function main() {
  const client = new Client(
    process.env.SHYFT_GRPC_ENDPOINT!,
    process.env.SHYFT_GRPC_TOKEN!,
    undefined
  );

  console.log('🔍 Testing AMM subscription...\n');
  console.log('AMM Program:', AMM_PROGRAM_ID);
  console.log('BC Program:', BC_PROGRAM_ID);
  console.log('\nListening for transactions...\n');

  const stream = await client.subscribe();
  
  let totalTxns = 0;
  let ammTxns = 0;
  let bcTxns = 0;
  const startTime = Date.now();

  stream.on('data', (data) => {
    if (data?.transaction) {
      totalTxns++;
      
      const tx = data.transaction?.transaction || data.transaction;
      const accounts = tx?.transaction?.message?.accountKeys || tx?.message?.accountKeys || [];
      
      // Convert accounts to strings
      const accountStrs = accounts.map((acc: any) => {
        if (typeof acc === 'string') return acc;
        if (acc instanceof Uint8Array || acc instanceof Buffer) return bs58.encode(acc);
        if (acc.pubkey) return acc.pubkey;
        return String(acc);
      });
      
      // Check for programs
      const hasAMM = accountStrs.includes(AMM_PROGRAM_ID);
      const hasBC = accountStrs.includes(BC_PROGRAM_ID);
      
      if (hasAMM) {
        ammTxns++;
        const signature = data.transaction?.signature || 
                         (tx?.transaction?.signatures?.[0] && bs58.encode(tx.transaction.signatures[0])) ||
                         'unknown';
        
        console.log(`✅ AMM Transaction #${ammTxns}:`);
        console.log(`   Signature: ${signature}`);
        console.log(`   Slot: ${data.slot || tx?.slot || 'unknown'}`);
        console.log(`   Accounts: ${accountStrs.length}`);
        
        // Check for logs
        const logs = tx?.meta?.logMessages || [];
        const hasSwapLog = logs.some((log: string) => 
          log.includes('SwapEvent') || 
          log.includes('swap') || 
          log.includes('buy') || 
          log.includes('sell')
        );
        console.log(`   Has swap logs: ${hasSwapLog}`);
        
        // Show first few logs
        if (logs.length > 0) {
          console.log('   First logs:');
          logs.slice(0, 3).forEach((log: string) => {
            console.log(`     - ${log.substring(0, 100)}${log.length > 100 ? '...' : ''}`);
          });
        }
        
        console.log('');
      } else if (hasBC) {
        bcTxns++;
      }
      
      // Show stats every 100 transactions
      if (totalTxns % 100 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        console.log(`📊 Stats after ${totalTxns} transactions (${elapsed.toFixed(1)}s):`);
        console.log(`   BC transactions: ${bcTxns} (${(bcTxns/totalTxns*100).toFixed(1)}%)`);
        console.log(`   AMM transactions: ${ammTxns} (${(ammTxns/totalTxns*100).toFixed(1)}%)`);
        console.log(`   TPS: ${(totalTxns/elapsed).toFixed(1)}\n`);
      }
    }
  });

  stream.on('error', (error) => {
    console.error('Stream error:', error);
  });

  // Subscribe to transactions
  const request = {
    accounts: {},
    slots: {},
    transactions: {
      // Subscribe to both BC and AMM programs
      pump_programs: {
        vote: false,
        failed: false,
        accountInclude: [BC_PROGRAM_ID, AMM_PROGRAM_ID],
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

  stream.write(request, (err: any) => {
    if (err) {
      console.error('Failed to subscribe:', err);
      process.exit(1);
    }
    console.log('✅ Subscribed successfully!\n');
  });

  // Run for 2 minutes
  setTimeout(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    console.log('\n🏁 Final Results:');
    console.log(`Total transactions: ${totalTxns}`);
    console.log(`BC transactions: ${bcTxns} (${(bcTxns/totalTxns*100).toFixed(1)}%)`);
    console.log(`AMM transactions: ${ammTxns} (${(ammTxns/totalTxns*100).toFixed(1)}%)`);
    console.log(`Duration: ${elapsed.toFixed(1)}s`);
    console.log(`Average TPS: ${(totalTxns/elapsed).toFixed(1)}`);
    
    if (ammTxns === 0) {
      console.log('\n❌ WARNING: No AMM transactions detected!');
      console.log('This suggests the subscription might not be working correctly.');
    }
    
    stream.end();
    process.exit(0);
  }, 120000); // 2 minutes
}

main().catch(console.error);