/**
 * Quick AMM Parsing Test - Properly closes streams
 * Tests the AMM parsing for a short duration with proper cleanup
 */

import * as dotenv from 'dotenv';
dotenv.config();

import Client, { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import { UnifiedEventParser } from '../utils/parsers/unified-event-parser';
import { EventBus } from '../core/event-bus';
import { EventType } from '../utils/parsers/types';
import bs58 from 'bs58';

const AMM_PROGRAM_ID = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';

async function quickTest() {
  console.log('🧪 Quick AMM Parsing Test (30 seconds)...\n');
  
  let client: Client | null = null;
  let stream: any = null;
  
  // Cleanup function
  const cleanup = async () => {
    console.log('\n🧹 Cleaning up...');
    try {
      if (stream) {
        stream.end();
        stream.removeAllListeners();
        await new Promise(resolve => setTimeout(resolve, 100)); // Give it time to close
      }
      if (client) {
        client.close();
        await new Promise(resolve => setTimeout(resolve, 100)); // Give it time to close
      }
    } catch (e) {
      console.error('Cleanup error (safe to ignore):', e);
    }
  };
  
  // Set up signal handlers
  process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT');
    await cleanup();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM');
    await cleanup();
    process.exit(0);
  });
  
  try {
    // Create parser
    const eventBus = new EventBus();
    const parser = new UnifiedEventParser({ eventBus, logErrors: false });
    
    // Track results
    let totalAmm = 0;
    let parsed = 0;
    let samples: any[] = [];
    
    // Connect to Shyft
    client = new Client(
      process.env.SHYFT_GRPC_ENDPOINT!,
      process.env.SHYFT_GRPC_TOKEN!,
      undefined
    );
    
    stream = await client.subscribe();
    
    stream.on('data', (data: any) => {
      if (data?.transaction) {
        const tx = data.transaction?.transaction || data.transaction;
        const accounts = tx?.transaction?.message?.accountKeys || tx?.message?.accountKeys || [];
        
        const accountStrs = accounts.map((acc: any) => {
          if (typeof acc === 'string') return acc;
          if (acc instanceof Uint8Array || acc instanceof Buffer) return bs58.encode(acc);
          return String(acc);
        });
        
        if (accountStrs.includes(AMM_PROGRAM_ID)) {
          totalAmm++;
          
          const context = UnifiedEventParser.createContext(data);
          const event = parser.parse(context);
          
          if (event && event.type === EventType.AMM_TRADE) {
            parsed++;
            
            if (samples.length < 3) {
              const ammEvent = event as any;
              samples.push({
                type: ammEvent.tradeType === 0 ? 'BUY' : 'SELL',
                mint: ammEvent.mintAddress.slice(0, 8) + '...',
                sol: (Number(ammEvent.solAmount) / 1e9).toFixed(3),
                hasCorrectMint: ammEvent.mintAddress !== 'So11111111111111111111111111111111111111112',
                hasAmounts: ammEvent.solAmount > 0n && ammEvent.tokenAmount > 0n
              });
            }
          }
          
          // Show progress every 10 transactions
          if (totalAmm % 10 === 0) {
            console.log(`Processed ${totalAmm} AMM txns, parsed ${parsed} (${(parsed/totalAmm*100).toFixed(1)}%)`);
          }
        }
      }
    });
    
    stream.on('error', (error: any) => {
      console.error('Stream error:', error.message || error);
    });
    
    // Subscribe to AMM
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
    
    await new Promise((resolve, reject) => {
      stream.write(request, (err: any) => {
        if (err) {
          reject(err);
        } else {
          console.log('✅ Subscribed to AMM transactions\n');
          resolve(true);
        }
      });
    });
    
    // Run for 30 seconds
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    // Show results
    console.log('\n📊 Results:');
    console.log(`Total AMM transactions: ${totalAmm}`);
    console.log(`Successfully parsed: ${parsed} (${totalAmm > 0 ? (parsed/totalAmm*100).toFixed(1) : 0}%)`);
    
    if (samples.length > 0) {
      console.log('\n📝 Sample trades:');
      samples.forEach((s, i) => {
        console.log(`${i + 1}. ${s.type}: ${s.mint} - ${s.sol} SOL`);
        console.log(`   Mint OK: ${s.hasCorrectMint ? '✅' : '❌'}, Amounts OK: ${s.hasAmounts ? '✅' : '❌'}`);
      });
    }
    
    const parseRate = totalAmm > 0 ? (parsed/totalAmm*100) : 0;
    if (parseRate >= 80) {
      console.log('\n✅ SUCCESS: AMM parsing working well!');
    } else {
      console.log('\n⚠️  Parse rate lower than expected');
    }
    
  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await cleanup();
    console.log('✅ Cleanup complete');
  }
}

// Run the test
quickTest().then(() => {
  console.log('\n👋 Test complete, exiting...');
  process.exit(0);
}).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});