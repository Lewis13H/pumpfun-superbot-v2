/**
 * Test AMM Trade Enrichment
 * Tests the new reserve extraction from inner instructions
 */

import 'dotenv/config';
import { EventBus } from '../core/event-bus';
import { AmmTradeEnricher } from '../services/amm/amm-trade-enricher';
import { Logger } from '../core/logger';
import chalk from 'chalk';
import { EventType, TradeType } from '../utils/parsers/types';

const logger = new Logger({ context: 'TestAmmEnrichment', color: chalk.cyan });

async function testEnrichment() {
  const eventBus = new EventBus();
  const enricher = new AmmTradeEnricher(eventBus);
  
  // Listen for enrichment events
  eventBus.on('AMM_TRADE_ENRICHED', (data) => {
    logger.info('✅ Trade enriched!', data);
  });
  
  eventBus.on('FETCH_POOL_DATA_NEEDED', (data) => {
    logger.warn('⚠️  Pool data needed', data);
  });
  
  // Create a mock AMM trade event
  const mockTrade = {
    type: EventType.AMM_TRADE as const,
    signature: 'test123',
    slot: 100000n,
    blockTime: Date.now() / 1000,
    programId: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
    tradeType: TradeType.BUY,
    mintAddress: '2qiRmdaAZSmYHy3KrCw43BGH7UFVcWjYKwdVzYDVpump',
    userAddress: 'testuser123',
    solAmount: 1000000000n, // 1 SOL
    tokenAmount: 1000000000000n, // 1000 tokens
    poolAddress: 'pooltest123',
    inputMint: 'So11111111111111111111111111111111111111112',
    inAmount: 1000000000n,
    outputMint: '2qiRmdaAZSmYHy3KrCw43BGH7UFVcWjYKwdVzYDVpump',
    outAmount: 1000000000000n,
    // Add mock context with token balances
    context: {
      signature: 'test123',
      slot: 100000n,
      blockTime: Date.now() / 1000,
      accounts: [],
      logs: [],
      postTokenBalances: [
        {
          accountIndex: 0,
          mint: '2qiRmdaAZSmYHy3KrCw43BGH7UFVcWjYKwdVzYDVpump',
          owner: 'pooltest123',
          uiTokenAmount: {
            amount: '100000000000000', // 100T tokens in pool
            decimals: 6,
            uiAmount: 100000000
          }
        },
        {
          accountIndex: 1,
          mint: 'So11111111111111111111111111111111111111112',
          owner: 'pooltest123',
          uiTokenAmount: {
            amount: '50000000000', // 50 SOL in pool
            decimals: 9,
            uiAmount: 50
          }
        }
      ]
    }
  };
  
  logger.info('Testing enrichment with mock trade...');
  
  // Emit pre-process event
  await eventBus.emit('PRE_PROCESS_TRADE', mockTrade);
  
  // Wait a bit for async processing
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Check if reserves were added
  logger.info('Trade after enrichment:', {
    hasReserves: !!(mockTrade.virtualSolReserves && mockTrade.virtualTokenReserves),
    solReserves: mockTrade.virtualSolReserves?.toString(),
    tokenReserves: mockTrade.virtualTokenReserves?.toString()
  });
  
  // Test without context
  const mockTrade2 = {
    ...mockTrade,
    signature: 'test456',
    context: undefined
  };
  
  logger.info('\nTesting enrichment without context...');
  await eventBus.emit('PRE_PROCESS_TRADE', mockTrade2);
  
  await new Promise(resolve => setTimeout(resolve, 100));
}

testEnrichment()
  .then(() => {
    logger.info('✅ Test completed');
    process.exit(0);
  })
  .catch(error => {
    logger.error('Test failed', error);
    process.exit(1);
  });