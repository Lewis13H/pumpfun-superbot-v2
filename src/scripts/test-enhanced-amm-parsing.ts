/**
 * Test Enhanced AMM Parsing
 * Verifies that the new discriminator-based AMM parsing is working correctly
 */

import * as dotenv from 'dotenv';
dotenv.config();

import Client, { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import { UnifiedEventParser } from '../utils/parsers/unified-event-parser';
import { ParseContext, EventType } from '../utils/parsers/types';
import { EventBus } from '../core/event-bus';
import { Logger } from '../core/logger';
import bs58 from 'bs58';

const AMM_PROGRAM_ID = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const logger = new Logger({ context: 'TestEnhancedAMM' });

async function main() {
  const client = new Client(
    process.env.SHYFT_GRPC_ENDPOINT!,
    process.env.SHYFT_GRPC_TOKEN!,
    undefined
  );

  console.log('🧪 Testing Enhanced AMM Parsing...\n');
  
  // Initialize parser with enhanced strategy
  const eventBus = new EventBus();
  const parser = new UnifiedEventParser({ eventBus, logErrors: true });
  
  const stream = await client.subscribe();
  
  let totalAmmTxns = 0;
  let parsedAmmTxns = 0;
  let buyCount = 0;
  let sellCount = 0;
  const startTime = Date.now();

  stream.on('data', async (data) => {
    if (data?.transaction) {
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
        totalAmmTxns++;
        
        const signature = data.transaction?.signature || 
                         (tx?.transaction?.signatures?.[0] && bs58.encode(tx.transaction.signatures[0])) ||
                         'unknown';
        
        // Create parse context
        const context: ParseContext = {
          signature,
          slot: BigInt(data.slot || tx?.slot || 0),
          blockTime: tx?.blockTime || Math.floor(Date.now() / 1000),
          accounts: accountStrs,
          logs: tx?.meta?.logMessages || [],
          instructions: tx?.transaction?.message?.compiledInstructions || 
                        tx?.message?.compiledInstructions || 
                        tx?.transaction?.message?.instructions ||
                        tx?.message?.instructions || [],
          innerInstructions: tx?.meta?.innerInstructions || [],
          programId: AMM_PROGRAM_ID
        };
        
        // Try to parse
        const event = parser.parse(context);
        
        if (event && event.type === EventType.AMM_TRADE) {
          parsedAmmTxns++;
          
          const ammEvent = event as any;
          if (ammEvent.tradeType === 'buy' || ammEvent.tradeType === 0) {
            buyCount++;
          } else {
            sellCount++;
          }
          
          console.log(`✅ Parsed AMM Trade #${parsedAmmTxns}:`);
          console.log(`   Type: ${ammEvent.tradeType === 'buy' || ammEvent.tradeType === 0 ? 'BUY' : 'SELL'}`);
          console.log(`   Mint: ${ammEvent.mintAddress}`);
          console.log(`   User: ${ammEvent.userAddress}`);
          console.log(`   Pool: ${ammEvent.poolAddress}`);
          console.log(`   SOL Amount: ${ammEvent.solAmount}`);
          console.log(`   Token Amount: ${ammEvent.tokenAmount}`);
          console.log(`   Strategy: ${event.parsedBy || 'unknown'}`);
          console.log('');
        } else {
          // Log failure details
          console.log(`❌ Failed to parse AMM transaction #${totalAmmTxns}`);
          console.log(`   Signature: ${signature}`);
          console.log(`   Instructions: ${context.instructions.length}`);
          console.log(`   Inner Instructions: ${context.innerInstructions.length}`);
          console.log(`   Has logs: ${context.logs.length > 0}`);
          
          // Check for discriminators in instructions
          context.instructions.forEach((ix: any, i: number) => {
            const programIdIndex = ix.programIdIndex || ix.programId;
            const programId = typeof programIdIndex === 'number' ? accountStrs[programIdIndex] : programIdIndex;
            
            if (programId === AMM_PROGRAM_ID && ix.data) {
              const dataBuffer = typeof ix.data === 'string' ? 
                Buffer.from(ix.data, 'base64') : 
                Buffer.from(ix.data);
              
              if (dataBuffer.length >= 8) {
                const discriminator = dataBuffer.slice(0, 8);
                console.log(`   AMM Instruction ${i} discriminator: ${discriminator.toString('hex')}`);
              }
            }
          });
          
          console.log('');
        }
        
        // Show stats every 10 AMM transactions
        if (totalAmmTxns % 10 === 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          const parseRate = (parsedAmmTxns / totalAmmTxns * 100).toFixed(1);
          console.log(`📊 Stats: ${parsedAmmTxns}/${totalAmmTxns} parsed (${parseRate}%)`);
          console.log(`   Buys: ${buyCount}, Sells: ${sellCount}`);
          console.log(`   Duration: ${elapsed.toFixed(1)}s\n`);
        }
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

  // Run for 1 minute
  setTimeout(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    const parseRate = totalAmmTxns > 0 ? (parsedAmmTxns / totalAmmTxns * 100).toFixed(1) : '0';
    
    console.log('\n🏁 Final Results:');
    console.log(`Total AMM transactions: ${totalAmmTxns}`);
    console.log(`Successfully parsed: ${parsedAmmTxns} (${parseRate}%)`);
    console.log(`Buys: ${buyCount}`);
    console.log(`Sells: ${sellCount}`);
    console.log(`Duration: ${elapsed.toFixed(1)}s`);
    console.log(`Average TPS: ${(totalAmmTxns / elapsed).toFixed(1)}`);
    
    if (parseRate < '50') {
      console.log('\n⚠️  WARNING: Parse rate is low. The enhanced parser may need adjustment.');
    } else {
      console.log('\n✅ SUCCESS: Enhanced AMM parser is working well!');
    }
    
    stream.end();
    process.exit(0);
  }, 60000); // 1 minute
}

main().catch(console.error);