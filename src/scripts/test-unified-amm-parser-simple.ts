import 'dotenv/config';
import { UnifiedAmmTradeStrategy } from '../utils/parsers/strategies/unified-amm-trade-strategy';
import { ParseContext } from '../utils/parsers/types';
import { AMM_PROGRAM } from '../utils/config/constants';

async function testUnifiedAmmParserSimple() {
  console.log('\n🧪 Testing Unified AMM Parser (Simple)...\n');
  
  const parser = new UnifiedAmmTradeStrategy();
  
  // Test 1: Basic canParse test
  console.log('Test 1: Can parse AMM transaction...');
  const context: ParseContext = {
    signature: 'test-sig',
    slot: BigInt(123456),
    blockTime: Date.now() / 1000,
    accounts: [AMM_PROGRAM],
    logs: ['test log']
  };
  
  const canParse = parser.canParse(context);
  console.log('  Can parse:', canParse);
  
  // Test 2: Parse with mock event log
  console.log('\nTest 2: Parse with mock SwapEvent log...');
  const swapContext: ParseContext = {
    signature: 'test-swap-sig',
    slot: BigInt(123456),
    blockTime: Date.now() / 1000,
    accounts: [AMM_PROGRAM],
    logs: [
      'Program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA invoke [1]',
      'Program log: SwapEvent',
      'Program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA success'
    ]
  };
  
  const result = parser.parse(swapContext);
  console.log('  Result:', result ? 'SUCCESS' : 'NULL');
  if (result) {
    console.log('  Type:', result.type);
    console.log('  Signature:', result.signature);
  }
  
  console.log('\n✅ Simple test completed!');
}

// Run the test
testUnifiedAmmParserSimple().catch(console.error);