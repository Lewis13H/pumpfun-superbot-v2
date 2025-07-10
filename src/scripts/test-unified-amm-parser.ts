import 'dotenv/config';
import { UnifiedEventParser } from '../utils/parsers/unified-event-parser';
import { ParseContext } from '../utils/parsers/types';
import { AMM_PROGRAM, WSOL_ADDRESS } from '../utils/config/constants';
import { logger } from '../core/logger';

async function testUnifiedAmmParser() {
  console.log('\n🧪 Testing Unified AMM Parser...\n');
  
  // Force use of consolidated parsers
  process.env.USE_CONSOLIDATED_PARSERS = 'true';
  
  const parser = new UnifiedEventParser({ logErrors: true });
  
  // Test 1: Parse from event logs (IDL)
  console.log('Test 1: Parsing AMM trade from event logs...');
  const eventLogContext: ParseContext = {
    signature: 'test-event-log-sig',
    slot: BigInt(123456),
    blockTime: Date.now() / 1000,
    accounts: [
      'UserAddressExample',
      'PoolAddressExample', 
      'MintAddressExample',
      'SystemProgram11111111111111111111111111111111',
      AMM_PROGRAM
    ],
    logs: [
      'Program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA invoke [1]',
      'Program log: Instruction: Swap',
      'Program data: SwapEvent user:UserAddressExample input_mint:So11111111111111111111111111111111111111112 output_mint:MintAddressExample input_amount:1000000000 output_amount:50000000 pool_sol_reserves:100000000000 pool_token_reserves:5000000000000',
      'Program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA consumed 45123 of 200000 compute units',
      'Program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA success'
    ],
    userAddress: 'UserAddressExample'
  };
  
  const eventResult = parser.parse(eventLogContext);
  console.log('  Result:', eventResult ? 'SUCCESS' : 'NULL');
  if (eventResult) {
    console.log('  Trade Type:', eventResult.tradeType);
    console.log('  SOL Amount:', eventResult.solAmount?.toString());
    console.log('  Token Amount:', eventResult.tokenAmount?.toString());
    console.log('  Strategy:', parser.getStats().byStrategy);
  }
  
  // Test 2: Parse from inner instructions
  console.log('\nTest 2: Parsing AMM trade from inner instructions...');
  const innerIxContext: ParseContext = {
    signature: 'test-inner-ix-sig',
    slot: BigInt(123457),
    blockTime: Date.now() / 1000,
    accounts: [
      'UserAddressExample',
      'TokenAccountUser',
      'TokenAccountPool',
      'PoolAddressExample',
      AMM_PROGRAM,
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      'MintAddressExample',
      WSOL_ADDRESS
    ],
    logs: [
      'Program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA invoke [1]',
      'Program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA success'
    ],
    innerInstructions: [
      {
        index: 0,
        instructions: [
          {
            programIdIndex: 5, // Token program
            accounts: [1, 2], // source, dest
            data: 'AwECAwQFBgcI' // Mock transfer data with amount
          }
        ]
      }
    ],
    userAddress: 'UserAddressExample'
  };
  
  const innerResult = parser.parse(innerIxContext);
  console.log('  Result:', innerResult ? 'SUCCESS' : 'NULL');
  if (innerResult) {
    console.log('  Trade Type:', innerResult.tradeType);
    console.log('  Mint:', innerResult.mintAddress);
  }
  
  // Test 3: Parse from log patterns
  console.log('\nTest 3: Parsing AMM trade from log patterns...');
  const logPatternContext: ParseContext = {
    signature: 'test-log-pattern-sig',
    slot: BigInt(123458),
    blockTime: Date.now() / 1000,
    accounts: [AMM_PROGRAM],
    logs: [
      'Program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA invoke [1]',
      'Swap completed user: UserAddressExample input_mint: So11111111111111111111111111111111111111112 output_mint: MintAddressExample input_amount: 2000000000 output_amount: 100000000',
      'Program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA success'
    ],
    userAddress: 'UserAddressExample'
  };
  
  const logResult = parser.parse(logPatternContext);
  console.log('  Result:', logResult ? 'SUCCESS' : 'NULL');
  
  // Test 4: Fallback to heuristic parser
  console.log('\nTest 4: Testing fallback to heuristic parser...');
  const heuristicContext: ParseContext = {
    signature: 'test-heuristic-sig',
    slot: BigInt(123459),
    blockTime: Date.now() / 1000,
    accounts: [AMM_PROGRAM],
    logs: [], // No logs to parse
    data: Buffer.from([102, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]), // Buy discriminator
    fullTransaction: {
      transaction: {
        transaction: {
          transaction: {
            message: {
              accountKeys: ['UserAddress', 'PoolAddress', 'MintAddress', AMM_PROGRAM],
              instructions: [{
                programIdIndex: 3,
                accounts: [0, 1, 2],
                data: Buffer.from([102, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]).toString('base64')
              }]
            }
          }
        }
      }
    }
  };
  
  const heuristicResult = parser.parse(heuristicContext);
  console.log('  Result:', heuristicResult ? 'SUCCESS' : 'NULL');
  
  // Display final stats
  console.log('\n📊 Parser Statistics:');
  const stats = parser.getStats();
  console.log(`  Total Attempts: ${stats.total}`);
  console.log(`  Successfully Parsed: ${stats.parsed}`);
  console.log(`  Failed: ${stats.failed}`);
  console.log(`  Parse Rate: ${((stats.parsed / stats.total) * 100).toFixed(1)}%`);
  console.log('\n  By Strategy:');
  if (stats.byStrategy instanceof Map) {
    stats.byStrategy.forEach((count, strategy) => {
      console.log(`    ${strategy}: ${count}`);
    });
  } else {
    console.log('    (No strategy stats available)');
  }
  
  console.log('\n✅ Unified AMM parser test completed!');
  
  // Test with legacy parsers for comparison
  console.log('\n\n📊 Testing with Legacy Parsers for Comparison...\n');
  process.env.USE_CONSOLIDATED_PARSERS = 'false';
  const legacyParser = new UnifiedEventParser({ logErrors: true });
  
  // Run same tests with legacy parser
  const legacyResults = [
    legacyParser.parse(eventLogContext),
    legacyParser.parse(innerIxContext),
    legacyParser.parse(logPatternContext),
    legacyParser.parse(heuristicContext)
  ];
  
  console.log('Legacy Parser Results:');
  legacyResults.forEach((result, i) => {
    console.log(`  Test ${i + 1}: ${result ? 'SUCCESS' : 'NULL'}`);
  });
  
  const legacyStats = legacyParser.getStats();
  console.log('\nLegacy Parser Stats:');
  console.log(`  Parse Rate: ${((legacyStats.parsed / legacyStats.total) * 100).toFixed(1)}%`);
  console.log('  By Strategy:');
  if (legacyStats.byStrategy instanceof Map) {
    legacyStats.byStrategy.forEach((count, strategy) => {
      if (count > 0) console.log(`    ${strategy}: ${count}`);
    });
  }
}

// Run the test
testUnifiedAmmParser().catch(console.error);