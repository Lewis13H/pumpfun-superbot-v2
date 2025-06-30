#!/usr/bin/env tsx

/**
 * Test the parser with mock pump.fun transaction data
 */

import 'dotenv/config';
import chalk from 'chalk';
import bs58 from 'bs58';
import { UnifiedEventParser } from '../src/parsers/unified-event-parser';
import { EventType, TradeType } from '../src/parsers/types';
import { PUMP_PROGRAM } from '../src/utils/constants';

console.log(chalk.blue('================================'));
console.log(chalk.blue('Parser Test with Mock Data'));
console.log(chalk.blue('================================\n'));

// Create parser
const parser = new UnifiedEventParser({ logErrors: true });

// Mock pump.fun transaction data
const mockData = {
  transaction: {
    signature: 'mock123456789',
    transaction: {
      transaction: {
        message: {
          accountKeys: [
            bs58.decode('11111111111111111111111111111111'), // user wallet
            bs58.decode('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'), // pump program
            bs58.decode('So11111111111111111111111111111111111111112'), // mint
            bs58.decode('BondingCurve11111111111111111111111111111') // bonding curve
          ],
          instructions: [{
            programIdIndex: 1, // Points to pump program
            accounts: [0, 2, 3], // user, mint, bonding curve
            data: Buffer.from([
              // Discriminator (8 bytes) - example for buy
              0x66, 0x06, 0x3d, 0x12, 0x01, 0x00, 0x00, 0x00,
              // Mint (32 bytes)
              ...Buffer.alloc(32, 1),
              // SOL amount (8 bytes) - 0.1 SOL
              0x00, 0xe1, 0xf5, 0x05, 0x00, 0x00, 0x00, 0x00,
              // Token amount (8 bytes) - 1000000 tokens
              0x40, 0x42, 0x0f, 0x00, 0x00, 0x00, 0x00, 0x00,
              // User address (32 bytes)
              ...Buffer.alloc(32, 2),
              // Bonding curve (32 bytes)
              ...Buffer.alloc(32, 3),
              // Virtual SOL reserves (8 bytes) - 45 SOL
              0x00, 0xb4, 0xae, 0xa7, 0x06, 0x00, 0x00, 0x00,
              // Virtual token reserves (8 bytes)
              0x00, 0x00, 0x64, 0xa7, 0xb3, 0xb6, 0xe0, 0x0d
            ]).toString('base64')
          }]
        }
      },
      meta: {
        logMessages: [
          'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
          'Program log: Instruction: Buy',
          'Program log: User bought 1000000.000000 tokens for 0.100000000 SOL',
          'Program log: mint: mockMintAddress1111111111111111111111111111',
          'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P consumed 25000 of 200000 compute units',
          'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success'
        ]
      }
    }
  },
  slot: 250000000n,
  blockTime: Math.floor(Date.now() / 1000)
};

// Test 1: Parse with instruction data
console.log(chalk.cyan('Test 1: Parsing with instruction data (225 bytes)'));

// Debug the mock data structure
console.log('Mock data structure:', {
  hasTransaction: !!mockData.transaction,
  hasNestedTransaction: !!mockData.transaction?.transaction,
  hasMessage: !!mockData.transaction?.transaction?.transaction?.message,
  accountKeysLength: mockData.transaction?.transaction?.transaction?.message?.accountKeys?.length
});

const context1 = UnifiedEventParser.createContext(mockData);
console.log('Context created:', {
  signature: context1.signature.substring(0, 20) + '...',
  accounts: context1.accounts.length,
  accountsDetail: context1.accounts.slice(0, 3),
  logs: context1.logs.length,
  hasData: !!context1.data,
  dataSize: context1.data?.length
});

const event1 = parser.parse(context1);
if (event1) {
  console.log(chalk.green('✅ Successfully parsed!'));
  console.log('Event:', {
    type: event1.type,
    tradeType: event1.tradeType,
    mintAddress: event1.mintAddress.substring(0, 20) + '...',
    userAddress: event1.userAddress.substring(0, 20) + '...',
    solAmount: Number(event1.solAmount) / 1e9 + ' SOL',
    tokenAmount: Number(event1.tokenAmount) / 1e6 + ' tokens'
  });
} else {
  console.log(chalk.red('❌ Failed to parse'));
}

// Test 2: Parse with only logs (no instruction data)
console.log(chalk.cyan('\nTest 2: Parsing with only logs (no instruction data)'));
const mockDataNoInstruction = {
  ...mockData,
  transaction: {
    ...mockData.transaction,
    transaction: {
      ...mockData.transaction.transaction,
      transaction: {
        ...mockData.transaction.transaction.transaction,
        message: {
          ...mockData.transaction.transaction.transaction.message,
          instructions: [] // No instruction data
        }
      }
    }
  }
};

const context2 = UnifiedEventParser.createContext(mockDataNoInstruction);
const event2 = parser.parse(context2);
if (event2) {
  console.log(chalk.green('✅ Successfully parsed from logs!'));
  console.log('Event:', {
    type: event2.type,
    tradeType: event2.tradeType,
    mintAddress: event2.mintAddress
  });
} else {
  console.log(chalk.red('❌ Failed to parse from logs'));
}

// Test 3: Sell transaction
console.log(chalk.cyan('\nTest 3: Parsing sell transaction'));
const mockSellData = {
  ...mockData,
  transaction: {
    ...mockData.transaction,
    transaction: {
      ...mockData.transaction.transaction,
      meta: {
        logMessages: [
          'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
          'Program log: Instruction: Sell',
          'Program log: User sold 500000.000000 tokens for 0.050000000 SOL',
          'Program log: mint: mockMintAddress2222222222222222222222222222',
          'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success'
        ]
      }
    }
  }
};

const context3 = UnifiedEventParser.createContext(mockSellData);
const event3 = parser.parse(context3);
if (event3) {
  console.log(chalk.green('✅ Successfully parsed sell!'));
  console.log('Event:', {
    type: event3.type,
    tradeType: event3.tradeType,
    mintAddress: event3.mintAddress
  });
} else {
  console.log(chalk.red('❌ Failed to parse sell'));
}

// Show parser statistics
console.log(chalk.cyan('\nParser Statistics:'));
console.log(parser.getStats());

console.log(chalk.blue('\n================================'));
console.log(chalk.green('Test complete!'));