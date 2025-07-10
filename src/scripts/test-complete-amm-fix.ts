/**
 * Test Complete AMM Fix
 * Verifies that:
 * 1. AMM transactions are parsed with correct discriminators
 * 2. Mint addresses are extracted correctly (not SOL)
 * 3. Amounts are parsed from instruction data
 * 4. Graduation detection updates token records
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { getGlobalContainer } from '../core/container';
import { Logger } from '../core/logger';
import { UnifiedEventParser } from '../utils/parsers/unified-event-parser';
import { EventBus, EVENTS } from '../core/event-bus';
import { EventType } from '../utils/parsers/types';
import Client, { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import bs58 from 'bs58';

const AMM_PROGRAM_ID = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const logger = new Logger({ context: 'TestCompleteAmmFix' });

async function testAmmParsing() {
  console.log('🧪 Testing Complete AMM Fix...\n');
  
  const eventBus = new EventBus();
  const parser = new UnifiedEventParser({ eventBus, logErrors: true });
  
  // Track parsing results
  const results = {
    totalAmm: 0,
    parsed: 0,
    correctMint: 0,
    hasAmounts: 0,
    graduations: 0,
    samples: [] as any[]
  };
  
  // Listen for graduation events
  eventBus.on(EVENTS.TOKEN_GRADUATED, (data: any) => {
    results.graduations++;
    console.log(`🎓 Token Graduated: ${data.mintAddress} at $${data.marketCapUsd.toFixed(2)}`);
  });
  
  // Connect to stream
  const client = new Client(
    process.env.SHYFT_GRPC_ENDPOINT!,
    process.env.SHYFT_GRPC_TOKEN!,
    undefined
  );
  
  const stream = await client.subscribe();
  
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
        results.totalAmm++;
        
        const signature = data.transaction?.signature || 
                         (tx?.transaction?.signatures?.[0] && bs58.encode(tx.transaction.signatures[0])) ||
                         'unknown';
        
        // Create parse context
        const context = UnifiedEventParser.createContext(data);
        
        // Parse the event
        const event = parser.parse(context);
        
        if (event && event.type === EventType.AMM_TRADE) {
          results.parsed++;
          
          const ammEvent = event as any;
          
          // Check mint address (should NOT be SOL)
          const isCorrectMint = ammEvent.mintAddress !== 'So11111111111111111111111111111111111111112';
          if (isCorrectMint) results.correctMint++;
          
          // Check amounts (should not be 0)
          const hasAmounts = ammEvent.solAmount > 0n && ammEvent.tokenAmount > 0n;
          if (hasAmounts) results.hasAmounts++;
          
          // Log sample for first few trades
          if (results.samples.length < 5) {
            results.samples.push({
              signature: ammEvent.signature,
              mintAddress: ammEvent.mintAddress,
              tradeType: ammEvent.tradeType === 0 ? 'BUY' : 'SELL',
              solAmount: ammEvent.solAmount.toString(),
              tokenAmount: ammEvent.tokenAmount.toString(),
              parsedBy: ammEvent.parsedBy || event.parsedBy || 'unknown'
            });
            
            console.log(`✅ Parsed AMM Trade #${results.parsed}:`);
            console.log(`   Type: ${ammEvent.tradeType === 0 ? 'BUY' : 'SELL'}`);
            console.log(`   Mint: ${ammEvent.mintAddress} ${isCorrectMint ? '✓' : '✗ (SOL mint!)'}`);
            console.log(`   User: ${ammEvent.userAddress}`);
            console.log(`   Pool: ${ammEvent.poolAddress}`);
            console.log(`   SOL Amount: ${Number(ammEvent.solAmount) / 1e9} SOL ${hasAmounts ? '✓' : '✗'}`);
            console.log(`   Token Amount: ${ammEvent.tokenAmount} ${hasAmounts ? '✓' : '✗'}`);
            console.log(`   Strategy: ${ammEvent.parsedBy || event.parsedBy || 'unknown'}`);
            console.log('');
          }
        } else if (results.totalAmm <= 5) {
          // Log failure details for first few
          console.log(`❌ Failed to parse AMM transaction #${results.totalAmm}`);
          console.log(`   Signature: ${signature}`);
          
          // Try to find discriminator
          const instructions = tx?.transaction?.message?.compiledInstructions || 
                             tx?.message?.compiledInstructions || [];
          
          for (const ix of instructions) {
            const programIdIndex = ix.programIdIndex;
            if (programIdIndex < accountStrs.length && accountStrs[programIdIndex] === AMM_PROGRAM_ID) {
              const dataBuffer = typeof ix.data === 'string' ? 
                Buffer.from(ix.data, 'base64') : 
                Buffer.from(ix.data || []);
              
              if (dataBuffer.length >= 8) {
                const discriminator = dataBuffer.slice(0, 8);
                console.log(`   AMM Instruction discriminator: ${discriminator.toString('hex')}`);
              }
            }
          }
          console.log('');
        }
        
        // Show stats every 10 AMM transactions
        if (results.totalAmm % 10 === 0) {
          showStats(results);
        }
      }
    }
  });
  
  stream.on('error', (error) => {
    console.error('Stream error:', error);
    cleanup();
  });
  
  // Cleanup function
  const cleanup = () => {
    try {
      stream.end();
      stream.removeAllListeners();
      client.close();
    } catch (e) {
      // Ignore cleanup errors
    }
  };
  
  // Handle process termination
  process.on('SIGINT', () => {
    console.log('\n\nReceived SIGINT, cleaning up...');
    cleanup();
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    console.log('\n\nReceived SIGTERM, cleaning up...');
    cleanup();
    process.exit(0);
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
  
  // Run for 2 minutes
  setTimeout(() => {
    console.log('\n🏁 Final Results:\n');
    showStats(results);
    
    // Show parsing quality
    const parseRate = results.totalAmm > 0 ? (results.parsed / results.totalAmm * 100) : 0;
    const mintRate = results.parsed > 0 ? (results.correctMint / results.parsed * 100) : 0;
    const amountRate = results.parsed > 0 ? (results.hasAmounts / results.parsed * 100) : 0;
    
    console.log('\n📊 Quality Metrics:');
    console.log(`Parse Rate: ${parseRate.toFixed(1)}% ${parseRate >= 90 ? '✅' : '❌'}`);
    console.log(`Correct Mint Rate: ${mintRate.toFixed(1)}% ${mintRate >= 95 ? '✅' : '❌'}`);
    console.log(`Valid Amounts Rate: ${amountRate.toFixed(1)}% ${amountRate >= 90 ? '✅' : '❌'}`);
    console.log(`Graduations Detected: ${results.graduations}`);
    
    if (parseRate >= 90 && mintRate >= 95 && amountRate >= 90) {
      console.log('\n✅ SUCCESS: AMM parsing is working correctly!');
    } else {
      console.log('\n❌ ISSUES DETECTED:');
      if (parseRate < 90) console.log('  - Low parse rate');
      if (mintRate < 95) console.log('  - Mint addresses showing as SOL');
      if (amountRate < 90) console.log('  - Amounts showing as 0');
    }
    
    // Show sample trades
    if (results.samples.length > 0) {
      console.log('\n📝 Sample Trades:');
      results.samples.forEach((s, i) => {
        console.log(`\n${i + 1}. ${s.tradeType} Trade:`);
        console.log(`   Mint: ${s.mintAddress}`);
        console.log(`   SOL: ${Number(s.solAmount) / 1e9}`);
        console.log(`   Tokens: ${s.tokenAmount}`);
        console.log(`   Parser: ${s.parsedBy}`);
      });
    }
    
    cleanup();
    process.exit(0);
  }, 120000); // 2 minutes
}

function showStats(results: any) {
  const parseRate = results.totalAmm > 0 ? (results.parsed / results.totalAmm * 100).toFixed(1) : '0';
  console.log(`\n📊 Current Stats:`);
  console.log(`Total AMM txns: ${results.totalAmm}`);
  console.log(`Successfully parsed: ${results.parsed} (${parseRate}%)`);
  console.log(`Correct mint addresses: ${results.correctMint}`);
  console.log(`Valid amounts: ${results.hasAmounts}`);
  console.log(`Graduations detected: ${results.graduations}\n`);
}

async function main() {
  try {
    await testAmmParsing();
  } catch (error) {
    logger.error('Test failed', error as Error);
    process.exit(1);
  }
}

main().catch(console.error);