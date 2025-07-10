#!/usr/bin/env npx tsx

/**
 * Test Inner Instruction Parser
 * Verifies that inner instruction parsing works correctly
 */

import 'dotenv/config';
import chalk from 'chalk';
import { InnerInstructionParser } from '../utils/parsers/inner-instruction-parser';
import { ParseContext } from '../utils/parsers/types';
import { WSOL_ADDRESS } from '../utils/config/constants';

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

async function testInnerInstructionParser() {
  console.log(chalk.cyan('\n🧪 Testing Inner Instruction Parser\n'));
  
  const parser = new InnerInstructionParser();
  
  // Test 1: Parse SPL Token Transfer
  console.log('Test 1: SPL Token Transfer');
  const transferContext: ParseContext = {
    signature: 'test-transfer',
    slot: BigInt(123456),
    blockTime: Date.now() / 1000,
    accounts: [
      'SourceTokenAccount',
      'DestTokenAccount', 
      'UserAuthority',
      'MintAddress',
      TOKEN_PROGRAM_ID
    ],
    innerInstructions: [{
      index: 0,
      instructions: [{
        programIdIndex: 4, // Token program
        accounts: [0, 1], // source, dest
        // Transfer instruction (type 3) + amount (1 SOL = 1000000000)
        data: Buffer.from([3, 0, 202, 154, 59, 0, 0, 0, 0]).toString('base64')
      }]
    }]
  };
  
  const transfers = parser.extractTokenTransfers(transferContext);
  console.log(`  Found ${transfers.length} transfers`);
  if (transfers.length > 0) {
    console.log(chalk.green('  ✅ SUCCESS'));
    console.log(`  Source: ${transfers[0].source}`);
    console.log(`  Destination: ${transfers[0].destination}`);
    console.log(`  Amount: ${transfers[0].amount} (${Number(transfers[0].amount) / 1e9} SOL)`);
  } else {
    console.log(chalk.red('  ❌ FAILED - No transfers found'));
  }
  
  // Test 2: Parse SPL Token TransferChecked
  console.log('\nTest 2: SPL Token TransferChecked');
  const transferCheckedContext: ParseContext = {
    signature: 'test-transfer-checked',
    slot: BigInt(123457),
    blockTime: Date.now() / 1000,
    accounts: [
      'SourceTokenAccount',
      'DestTokenAccount',
      'MintAddress',
      'UserAuthority',
      TOKEN_PROGRAM_ID
    ],
    innerInstructions: [{
      index: 0,
      instructions: [{
        programIdIndex: 4, // Token program
        accounts: [0, 1, 2, 3], // source, dest, mint, authority
        // TransferChecked (type 12) + amount + decimals
        data: Buffer.from([12, 0, 232, 3, 0, 0, 0, 0, 0, 9]).toString('base64')
      }]
    }]
  };
  
  const checkedTransfers = parser.extractTokenTransfers(transferCheckedContext);
  console.log(`  Found ${checkedTransfers.length} transfers`);
  if (checkedTransfers.length > 0) {
    console.log(chalk.green('  ✅ SUCCESS'));
    console.log(`  Mint: ${checkedTransfers[0].mint}`);
    console.log(`  Amount: ${checkedTransfers[0].amount}`);
    console.log(`  Decimals: ${checkedTransfers[0].decimals}`);
  } else {
    console.log(chalk.red('  ❌ FAILED - No transfers found'));
  }
  
  // Test 3: Parse SOL Transfer
  console.log('\nTest 3: SOL Transfer');
  const solTransferContext: ParseContext = {
    signature: 'test-sol-transfer',
    slot: BigInt(123458),
    blockTime: Date.now() / 1000,
    accounts: [
      'SourceWallet',
      'DestWallet',
      '11111111111111111111111111111111' // System program
    ],
    innerInstructions: [{
      index: 0,
      instructions: [{
        programIdIndex: 2, // System program
        accounts: [0, 1], // source, dest
        // System transfer (type 2) + amount (0.1 SOL)
        data: Buffer.from([2, 0, 0, 0, 0, 225, 245, 5, 0, 0, 0, 0]).toString('base64')
      }]
    }]
  };
  
  const solTransfers = parser.extractTokenTransfers(solTransferContext);
  console.log(`  Found ${solTransfers.length} transfers`);
  if (solTransfers.length > 0) {
    console.log(chalk.green('  ✅ SUCCESS'));
    console.log(`  Source: ${solTransfers[0].source}`);
    console.log(`  Destination: ${solTransfers[0].destination}`);
    console.log(`  Amount: ${solTransfers[0].amount} lamports`);
    console.log(`  Mint: ${solTransfers[0].mint} (should be 'SOL')`);
  } else {
    console.log(chalk.red('  ❌ FAILED - No transfers found'));
  }
  
  // Test 4: Multiple transfers in one transaction
  console.log('\nTest 4: Multiple Transfers');
  const multiTransferContext: ParseContext = {
    signature: 'test-multi-transfer',
    slot: BigInt(123459),
    blockTime: Date.now() / 1000,
    accounts: [
      'UserSOLWallet',
      'PoolSOLWallet',
      'UserTokenAccount',
      'PoolTokenAccount',
      'MintAddress',
      TOKEN_PROGRAM_ID,
      '11111111111111111111111111111111'
    ],
    innerInstructions: [
      {
        index: 0,
        instructions: [
          {
            // SOL transfer
            programIdIndex: 6,
            accounts: [0, 1],
            data: Buffer.from([2, 0, 0, 0, 0, 202, 154, 59, 0, 0, 0, 0]).toString('base64')
          },
          {
            // Token transfer
            programIdIndex: 5,
            accounts: [3, 2], // pool to user (buy)
            data: Buffer.from([3, 0, 0, 0, 0, 0, 0, 0, 100]).toString('base64')
          }
        ]
      }
    ]
  };
  
  const multiTransfers = parser.extractTokenTransfers(multiTransferContext);
  console.log(`  Found ${multiTransfers.length} transfers`);
  if (multiTransfers.length === 2) {
    console.log(chalk.green('  ✅ SUCCESS - Found both transfers'));
    console.log('  Transfer 1:');
    console.log(`    Mint: ${multiTransfers[0].mint}`);
    console.log(`    Amount: ${multiTransfers[0].amount}`);
    console.log('  Transfer 2:');
    console.log(`    Mint: ${multiTransfers[1].mint || 'unknown'}`);
    console.log(`    Amount: ${multiTransfers[1].amount}`);
  } else {
    console.log(chalk.red(`  ❌ FAILED - Expected 2 transfers, found ${multiTransfers.length}`));
  }
  
  // Summary
  console.log(chalk.cyan('\n📊 Test Summary:'));
  console.log('The inner instruction parser is designed to extract token transfers');
  console.log('from the inner instructions of a transaction. This is crucial for');
  console.log('AMM trades where the actual transfer amounts are in inner instructions.');
}

// Run the test
testInnerInstructionParser().catch(console.error);