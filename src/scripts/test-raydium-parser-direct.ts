/**
 * Test Raydium Parser Directly with Sample Data
 */

import { Logger, LogLevel } from '../core/logger';
import { SimpleRaydiumTradeStrategy } from '../utils/parsers/strategies/raydium-trade-strategy-simple';

// Set log level to DEBUG for detailed output
Logger.setGlobalLevel(LogLevel.DEBUG);

const logger = new Logger({ context: 'TestParser' });

// Create a mock transaction based on what we've seen
const mockTransaction = {
  transaction: {
    message: {
      accountKeys: [
        // Mock account keys as buffers
        Buffer.from('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'utf8'), // 0: Token Program
        Buffer.from('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', 'utf8'),  // 1: AMM ID (example)
        Buffer.from('5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', 'utf8'), // 2: AMM Authority
        Buffer.from('AmmmAuthority1111111111111111111111111111111', 'utf8'), // 3: AMM Open Orders
        Buffer.from('AmmmTargetOrders111111111111111111111111111', 'utf8'),  // 4: AMM Target Orders
        Buffer.from('CoinVault11111111111111111111111111111111111', 'utf8'),  // 5: Pool Coin Vault
        Buffer.from('PcVault1111111111111111111111111111111111111', 'utf8'),  // 6: Pool PC Vault
        Buffer.from('SerumProgram111111111111111111111111111111111', 'utf8'), // 7: Serum Program
        Buffer.from('SerumMarket1111111111111111111111111111111111', 'utf8'), // 8: Serum Market
        Buffer.from('SerumBids11111111111111111111111111111111111', 'utf8'),  // 9: Serum Bids
        Buffer.from('SerumAsks11111111111111111111111111111111111', 'utf8'),  // 10: Serum Asks
        Buffer.from('SerumEvent1111111111111111111111111111111111', 'utf8'),  // 11: Serum Event Queue
        Buffer.from('SerumCoin11111111111111111111111111111111111', 'utf8'),  // 12: Serum Coin Vault
        Buffer.from('SerumPc1111111111111111111111111111111111111', 'utf8'),   // 13: Serum PC Vault
        Buffer.from('SerumSigner111111111111111111111111111111111', 'utf8'),  // 14: Serum Vault Signer
        Buffer.from('UserSource1111111111111111111111111111111111', 'utf8'),  // 15: User Source Token Account
        Buffer.from('UserDest111111111111111111111111111111111111', 'utf8'),  // 16: User Destination Token Account
        Buffer.from('UserOwner11111111111111111111111111111111111', 'utf8'),  // 17: User Owner
        Buffer.from('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', 'utf8'), // 18: Raydium Program
      ],
      instructions: [
        {
          programIdIndex: 18, // Points to Raydium program
          accounts: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
          data: Buffer.from([9, 0x10, 0x27, 0, 0, 0, 0, 0, 0, 0x20, 0x4e, 0, 0, 0, 0, 0, 0]).toString('base64') // SwapBaseIn with amounts
        }
      ]
    }
  },
  meta: {
    preTokenBalances: [
      {
        accountIndex: 5,
        mint: '5e6Y8yJ56i7nFwiks1Bqs5BXyN4DuvwHvdzoGYxjsHsn',
        owner: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',
        uiTokenAmount: { amount: '1000000000', uiAmountString: '1000.0' }
      },
      {
        accountIndex: 6,
        mint: 'So11111111111111111111111111111111111111112',
        owner: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',
        uiTokenAmount: { amount: '100000000000', uiAmountString: '100.0' }
      }
    ],
    postTokenBalances: [
      {
        accountIndex: 5,
        mint: '5e6Y8yJ56i7nFwiks1Bqs5BXyN4DuvwHvdzoGYxjsHsn',
        owner: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',
        uiTokenAmount: { amount: '1010000000', uiAmountString: '1010.0' }
      },
      {
        accountIndex: 6,
        mint: 'So11111111111111111111111111111111111111112',
        owner: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',
        uiTokenAmount: { amount: '99000000000', uiAmountString: '99.0' }
      }
    ],
    logMessages: [
      'Program 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8 invoke [1]',
      'Program log: Instruction: SwapBaseIn',
      'Program log: ray_log: AwCgTAAAAAAAAACg4gAAAAAAAAAAAAAAAAAAAIDhpAcAAAAAyBCqBwAAAAAA8LCRKAAAAABKnqQD'
    ]
  },
  signature: 'test-signature-12345',
  slot: 123456789,
  blockTime: Math.floor(Date.now() / 1000)
};

// Test the parser
const parser = new SimpleRaydiumTradeStrategy();

logger.info('Testing parser with mock Raydium transaction...');

// Test canParse
const canParse = parser.canParse(mockTransaction.transaction);
logger.info(`Can parse: ${canParse}`);

// Test parse
const events = parser.parse(mockTransaction.transaction, mockTransaction);
logger.info(`Events parsed: ${events.length}`);

if (events.length > 0) {
  logger.info('Parsed events:', events);
} else {
  logger.error('No events parsed from mock transaction');
}