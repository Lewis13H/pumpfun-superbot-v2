/**
 * Test the fixed Raydium parser
 */

import 'dotenv/config';
import { SimpleRaydiumTradeStrategy } from '../utils/parsers/strategies/raydium-trade-strategy-simple';
import chalk from 'chalk';

// Sample transaction structure based on the gRPC stream format
const sampleTransaction = {
  signature: "test-signature-12345",
  slot: 123456789,
  blockTime: 1704000000,
  transaction: {
    message: {
      accountKeys: [
        "11111111111111111111111111111111", // Token Program
        "AMM1234567890123456789012345678901234567890", // AMM ID
        "Auth234567890123456789012345678901234567890", // AMM Authority
        "Open234567890123456789012345678901234567890", // AMM Open Orders
        "Targ234567890123456789012345678901234567890", // AMM Target Orders
        "Coin234567890123456789012345678901234567890", // Pool Coin Vault
        "PC23234567890123456789012345678901234567890", // Pool PC Vault
        "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", // Serum Program
        "Mkt1234567890123456789012345678901234567890", // Serum Market
        "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium Program ID at index 9
        "User234567890123456789012345678901234567890" // User
      ],
      instructions: [
        {
          programIdIndex: 9, // Points to Raydium program
          accounts: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
          data: Buffer.from([9, 0, 0, 0, 0, 0, 0, 0]).toString('base64') // SwapBaseIn instruction
        }
      ]
    }
  },
  meta: {
    preTokenBalances: [
      { mint: "So11111111111111111111111111111111111111112", amount: "1000000000" },
      { mint: "TokenMint123456789012345678901234567890", amount: "5000000000" }
    ],
    postTokenBalances: [
      { mint: "So11111111111111111111111111111111111111112", amount: "900000000" },
      { mint: "TokenMint123456789012345678901234567890", amount: "5500000000" }
    ],
    logMessages: [
      "Program 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8 invoke [1]",
      "ray_log: SwapBaseIn",
      "Program 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8 consumed 12345 of 200000 compute units",
      "Program 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8 success"
    ]
  }
};

// Test with object-style account keys (as might come from gRPC)
const sampleTransactionWithObjects = {
  ...sampleTransaction,
  transaction: {
    ...sampleTransaction.transaction,
    message: {
      ...sampleTransaction.transaction.message,
      accountKeys: sampleTransaction.transaction.message.accountKeys.map(key => ({
        pubkey: key
      }))
    }
  }
};

async function testParser() {
  console.log(chalk.blue('\n=== Testing Fixed Raydium Parser ===\n'));
  
  const parser = new SimpleRaydiumTradeStrategy();
  
  // Test 1: String account keys
  console.log(chalk.yellow('Test 1: String account keys'));
  const canParse1 = parser.canParse(sampleTransaction);
  console.log(`Can parse: ${canParse1 ? chalk.green('✓') : chalk.red('✗')}`);
  
  if (canParse1) {
    const events1 = parser.parse(sampleTransaction, sampleTransaction);
    console.log(`Events parsed: ${events1.length}`);
    if (events1.length > 0) {
      console.log(chalk.green('✓ Successfully parsed transaction with string keys'));
      console.log('Event details:', {
        type: events1[0].type,
        tradeType: events1[0].tradeType,
        signature: events1[0].signature.slice(0, 8) + '...',
        mintAddress: events1[0].mintAddress
      });
    }
  }
  
  // Test 2: Object account keys
  console.log(chalk.yellow('\nTest 2: Object account keys'));
  const canParse2 = parser.canParse(sampleTransactionWithObjects);
  console.log(`Can parse: ${canParse2 ? chalk.green('✓') : chalk.red('✗')}`);
  
  if (canParse2) {
    const events2 = parser.parse(sampleTransactionWithObjects, sampleTransactionWithObjects);
    console.log(`Events parsed: ${events2.length}`);
    if (events2.length > 0) {
      console.log(chalk.green('✓ Successfully parsed transaction with object keys'));
    }
  }
  
  // Test 3: Missing data
  console.log(chalk.yellow('\nTest 3: Missing transaction data'));
  const badTransaction = { transaction: {} };
  const canParse3 = parser.canParse(badTransaction);
  console.log(`Can parse empty transaction: ${canParse3 ? chalk.red('✗ Should not parse') : chalk.green('✓ Correctly rejected')}`);
  
  console.log(chalk.blue('\n=== Parser Test Complete ===\n'));
}

testParser().catch(console.error);