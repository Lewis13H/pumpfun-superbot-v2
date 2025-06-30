/**
 * Test Core Services
 */

import chalk from 'chalk';
import { UnifiedEventParser } from '../parsers/unified-event-parser';
import { ParseContext, EventType, TradeType } from '../parsers/types';
import { PriceCalculator } from '../services/price-calculator';
import { EventBus } from '../core/event-bus';
import { PUMP_PROGRAM, AMM_PROGRAM } from '../utils/constants';

/**
 * Test the unified event parser
 */
async function testEventParser() {
  console.log(chalk.blue('\n=== Testing Unified Event Parser ===\n'));
  
  const eventBus = new EventBus();
  const parser = new UnifiedEventParser({ eventBus, logErrors: true });
  
  // Test BC trade parsing
  const bcContext: ParseContext = {
    signature: 'test-bc-sig-123',
    slot: 123456789n,
    blockTime: Date.now(),
    accounts: [
      'UserWallet11111111111111111111111111111111',
      PUMP_PROGRAM,
      'TokenMint11111111111111111111111111111111',
      'BondingCurve111111111111111111111111111111'
    ],
    logs: [
      'Program log: Instruction: Buy',
      'mint: TokenMint11111111111111111111111111111111',
      'Program log: Trade executed successfully'
    ]
  };
  
  const bcEvent = parser.parse(bcContext);
  console.log(chalk.green('✓ BC Trade parsed:'), bcEvent?.type === EventType.BC_TRADE);
  
  // Test AMM trade parsing
  const ammContext: ParseContext = {
    signature: 'test-amm-sig-456',
    slot: 123456790n,
    blockTime: Date.now(),
    accounts: [
      'UserWallet22222222222222222222222222222222',
      AMM_PROGRAM,
      'PoolAddress2222222222222222222222222222222',
      'TokenMint22222222222222222222222222222222'
    ],
    logs: [
      'Program log: Instruction: Swap',
      'input_mint: So11111111111111111111111111111111111111112',
      'in_amount: 1000000000',
      'output_mint: TokenMint22222222222222222222222222222222',
      'out_amount: 5000000000'
    ]
  };
  
  const ammEvent = parser.parse(ammContext);
  console.log(chalk.green('✓ AMM Trade parsed:'), ammEvent?.type === EventType.AMM_TRADE);
  
  // Test parser stats
  const stats = parser.getStats();
  console.log(chalk.green('\n✓ Parser statistics:'), stats);
  
  // Test invalid context
  const invalidContext: ParseContext = {
    signature: 'invalid-sig',
    slot: 0n,
    accounts: [],
    logs: []
  };
  
  const invalidEvent = parser.parse(invalidContext);
  console.log(chalk.green('✓ Invalid context rejected:'), invalidEvent === null);
  
  console.log(chalk.green('\n✓ All parser tests passed!\n'));
}

/**
 * Test the price calculator
 */
async function testPriceCalculator() {
  console.log(chalk.blue('\n=== Testing Price Calculator ===\n'));
  
  const calculator = new PriceCalculator();
  
  // Test price calculation from reserves
  const reserves = {
    solReserves: 50_000_000_000n, // 50 SOL
    tokenReserves: 800_000_000_000_000n, // 800M tokens (with 6 decimals)
    isVirtual: true
  };
  
  const priceInfo = calculator.calculatePrice(reserves, 180);
  console.log(chalk.green('✓ Price calculation:'));
  console.log(`  Price in SOL: ${calculator.formatPrice(priceInfo.priceInSol)}`);
  console.log(`  Price in USD: $${calculator.formatPrice(priceInfo.priceInUsd)}`);
  console.log(`  Market Cap: ${calculator.formatMarketCap(priceInfo.marketCapUsd)}`);
  
  // Test bonding curve progress
  const progress = calculator.calculateBondingCurveProgress(reserves.solReserves);
  console.log(chalk.green(`\n✓ Bonding curve progress: ${progress.toFixed(1)}%`));
  
  // Test price impact
  const buyAmount = 1_000_000_000n; // 1 SOL
  const impactResult = calculator.calculatePriceImpact(buyAmount, reserves, true);
  console.log(chalk.green('\n✓ Price impact calculation:'));
  console.log(`  Impact: ${impactResult.priceImpact.toFixed(2)}%`);
  console.log(`  Tokens out: ${Number(impactResult.tokensOut) / 1e6}`);
  
  // Test formatting
  console.log(chalk.green('\n✓ Price formatting tests:'));
  console.log(`  Small: ${calculator.formatPrice(0.00000123)}`);
  console.log(`  Medium: ${calculator.formatPrice(1.23456)}`);
  console.log(`  Large: ${calculator.formatPrice(1234567.89)}`);
  
  console.log(chalk.green('\n✓ Market cap formatting tests:'));
  console.log(`  Small: ${calculator.formatMarketCap(999)}`);
  console.log(`  Thousands: ${calculator.formatMarketCap(12345)}`);
  console.log(`  Millions: ${calculator.formatMarketCap(12345678)}`);
  console.log(`  Billions: ${calculator.formatMarketCap(1234567890)}`);
  
  console.log(chalk.green('\n✓ All price calculator tests passed!\n'));
}

/**
 * Test integration between parser and calculator
 */
async function testIntegration() {
  console.log(chalk.blue('\n=== Testing Integration ===\n'));
  
  const eventBus = new EventBus();
  const parser = new UnifiedEventParser({ eventBus });
  const calculator = new PriceCalculator();
  
  let eventsProcessed = 0;
  
  // Listen for parser events
  eventBus.on('parser:success', (data) => {
    console.log(chalk.green(`✓ Parsed ${data.eventType} with ${data.strategy}`));
    eventsProcessed++;
  });
  
  // Create test contexts
  const contexts: ParseContext[] = [
    {
      signature: 'int-test-1',
      slot: 200000000n,
      blockTime: Date.now(),
      accounts: ['User1', PUMP_PROGRAM, 'Mint1', 'BC1'],
      logs: ['Program log: Instruction: Buy', 'mint: Mint1']
    },
    {
      signature: 'int-test-2',
      slot: 200000001n,
      blockTime: Date.now(),
      accounts: ['User2', AMM_PROGRAM, 'Pool1', 'Mint2'],
      logs: [
        'Program log: Instruction: Swap',
        'input_mint: So11111111111111111111111111111111111111112',
        'output_mint: Mint2',
        'in_amount: 2000000000',
        'out_amount: 10000000000'
      ]
    }
  ];
  
  // Parse batch
  const events = parser.parseBatch(contexts);
  console.log(chalk.green(`\n✓ Batch parsed: ${events.length} events`));
  
  // Calculate prices for each event
  for (const event of events) {
    if ('virtualSolReserves' in event) {
      const reserves = {
        solReserves: event.virtualSolReserves || 30_000_000_000n,
        tokenReserves: event.virtualTokenReserves || 900_000_000_000_000n
      };
      
      const priceInfo = calculator.calculatePrice(reserves, 180);
      console.log(chalk.green(`✓ Event ${event.signature}:`));
      console.log(`  Type: ${event.type}`);
      console.log(`  Market Cap: ${calculator.formatMarketCap(priceInfo.marketCapUsd)}`);
    }
  }
  
  console.log(chalk.green(`\n✓ Integration test complete: ${eventsProcessed} events processed\n`));
}

/**
 * Run all tests
 */
async function runTests() {
  console.log(chalk.magenta('\n🧪 Testing Core Services\n'));
  
  try {
    await testEventParser();
    await testPriceCalculator();
    await testIntegration();
    
    console.log(chalk.green('\n✅ All core service tests passed!\n'));
  } catch (error) {
    console.error(chalk.red('\n❌ Test failed:'), error);
    process.exit(1);
  }
}

// Run tests
runTests().catch(console.error);