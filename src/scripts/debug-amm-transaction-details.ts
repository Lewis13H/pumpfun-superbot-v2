/**
 * Debug AMM Transaction Details
 * Gets detailed info about AMM transactions to understand why they're not being parsed
 */

import * as dotenv from 'dotenv';
dotenv.config();

import Client, { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

const AMM_PROGRAM_ID = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';

async function main() {
  const client = new Client(
    process.env.SHYFT_GRPC_ENDPOINT!,
    process.env.SHYFT_GRPC_TOKEN!,
    undefined
  );

  console.log('🔍 Analyzing AMM transaction details...\n');

  const stream = await client.subscribe();
  
  let ammTxnCount = 0;
  const maxToAnalyze = 5;

  stream.on('data', (data) => {
    if (data?.transaction && ammTxnCount < maxToAnalyze) {
      const tx = data.transaction?.transaction || data.transaction;
      const accounts = tx?.transaction?.message?.accountKeys || tx?.message?.accountKeys || [];
      
      // Convert accounts to strings
      const accountStrs = accounts.map((acc: any) => {
        if (typeof acc === 'string') return acc;
        if (acc instanceof Uint8Array || acc instanceof Buffer) return bs58.encode(acc);
        if (acc.pubkey) return acc.pubkey;
        return String(acc);
      });
      
      // Check for AMM program
      if (accountStrs.includes(AMM_PROGRAM_ID)) {
        ammTxnCount++;
        
        const signature = data.transaction?.signature || 
                         (tx?.transaction?.signatures?.[0] && bs58.encode(tx.transaction.signatures[0])) ||
                         'unknown';
        
        console.log(`\n=== AMM Transaction #${ammTxnCount} ===`);
        console.log(`Signature: ${signature}`);
        console.log(`Slot: ${data.slot || tx?.slot || 'unknown'}`);
        
        // Check instructions
        const instructions = tx?.transaction?.message?.compiledInstructions || 
                           tx?.message?.compiledInstructions || 
                           tx?.transaction?.message?.instructions ||
                           tx?.message?.instructions || [];
        
        console.log(`\nInstructions (${instructions.length}):`);
        instructions.forEach((ix: any, i: number) => {
          const programIdIndex = ix.programIdIndex || ix.programId;
          const programId = typeof programIdIndex === 'number' ? accountStrs[programIdIndex] : programIdIndex;
          console.log(`  [${i}] Program: ${programId}`);
          
          if (programId === AMM_PROGRAM_ID) {
            console.log(`       AMM Instruction!`);
            console.log(`       Accounts: ${ix.accounts?.length || 0}`);
            console.log(`       Data: ${ix.data ? (typeof ix.data === 'string' ? ix.data.substring(0, 50) : Buffer.from(ix.data).toString('hex').substring(0, 50)) + '...' : 'none'}`);
            
            // Try to decode the first 8 bytes as discriminator
            if (ix.data) {
              try {
                const dataBuffer = typeof ix.data === 'string' ? Buffer.from(ix.data, 'base64') : Buffer.from(ix.data);
                const discriminator = dataBuffer.slice(0, 8);
                console.log(`       Discriminator: ${discriminator.toString('hex')}`);
              } catch (e) {
                console.log(`       Could not decode discriminator`);
              }
            }
          }
        });
        
        // Check inner instructions
        const innerInstructions = tx?.meta?.innerInstructions || [];
        console.log(`\nInner Instructions: ${innerInstructions.length > 0 ? 'Yes' : 'No'}`);
        if (innerInstructions.length > 0) {
          console.log(`  Groups: ${innerInstructions.length}`);
          innerInstructions.forEach((group: any, i: number) => {
            console.log(`  Group ${i}: ${group.instructions?.length || 0} instructions`);
          });
        }
        
        // Check logs
        const logs = tx?.meta?.logMessages || [];
        console.log(`\nLogs (${logs.length}):`);
        const relevantLogs = logs.filter((log: string) => 
          !log.includes('ComputeBudget') && 
          !log.includes('invoke [1]') &&
          !log.includes('success')
        );
        
        relevantLogs.slice(0, 10).forEach((log: string) => {
          console.log(`  ${log}`);
        });
        
        // Look for specific patterns
        const hasSwapLog = logs.some((log: string) => 
          log.toLowerCase().includes('swap') || 
          log.includes('buy') || 
          log.includes('sell') ||
          log.includes('SwapEvent')
        );
        const hasEventLog = logs.some((log: string) => 
          log.includes('Program data:') || 
          log.includes('Program log:')
        );
        
        console.log(`\nAnalysis:`);
        console.log(`  Has swap-related logs: ${hasSwapLog}`);
        console.log(`  Has event logs: ${hasEventLog}`);
        console.log(`  Transaction status: ${tx?.meta?.err ? 'Failed' : 'Success'}`);
        
        // Check for ATA creation (indicates new pool or position)
        const hasATACreation = logs.some((log: string) => 
          log.includes('CreateIdempotent') || 
          log.includes('InitializeAccount')
        );
        console.log(`  Has ATA creation: ${hasATACreation}`);
        
        console.log('\n' + '='.repeat(50));
      }
    }
  });

  stream.on('error', (error) => {
    console.error('Stream error:', error);
  });

  // Subscribe to AMM transactions
  const request = {
    accounts: {},
    slots: {},
    transactions: {
      amm: {
        vote: false,
        failed: false,
        accountInclude: [AMM_PROGRAM_ID],
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
    console.log('✅ Subscribed to AMM transactions\n');
  });

  // Exit after analyzing enough transactions
  setTimeout(() => {
    console.log('\n✅ Analysis complete');
    stream.end();
    process.exit(0);
  }, 30000); // 30 seconds
}

main().catch(console.error);