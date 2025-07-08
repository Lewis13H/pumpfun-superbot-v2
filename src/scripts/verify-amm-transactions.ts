#!/usr/bin/env node
/**
 * Verify AMM Transaction Parsing
 * Shows actual trade amounts vs slippage parameters
 */

import 'dotenv/config';
import chalk from 'chalk';
import Client, { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import bs58 from 'bs58';

const AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// Discriminators
const DISCRIMINATORS = {
  BUY: Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]),
  SELL: Buffer.from([51, 230, 133, 164, 1, 127, 131, 173])
};

async function verifyAMMTransactions() {
  console.log(chalk.blue('Verifying AMM Transaction Amounts...'));
  console.log(chalk.gray('─'.repeat(60)));
  
  let transactionsAnalyzed = 0;
  const results: any[] = [];
  
  // Create gRPC client
  const client = new Client(
    process.env.SHYFT_GRPC_ENDPOINT || 'https://grpc.shyft.to',
    process.env.SHYFT_GRPC_TOKEN,
    undefined
  );
  const stream = await client.subscribe();
  
  // Set up stream handlers
  stream.on('data', (data: any) => {
    if (data.transaction) {
      try {
        const tx = data.transaction.transaction.transaction;
        const meta = data.transaction.transaction.meta;
        const accountKeys = tx.message?.accountKeys || [];
        
        // Convert account keys to strings
        const accountStrs = accountKeys.map((acc: any) => 
          typeof acc === 'string' ? acc : bs58.encode(acc)
        );
        
        // Check if it's an AMM transaction
        const isAMM = accountStrs.some(acc => acc === AMM_PROGRAM);
        if (!isAMM) return;
        
        // Find AMM instruction
        const instructions = tx.message?.instructions || [];
        let ammInstructionIndex = -1;
        let ammInstruction = null;
        
        for (let i = 0; i < instructions.length; i++) {
          const ix = instructions[i];
          const programIdIndex = ix.programIdIndex;
          if (programIdIndex >= accountStrs.length) continue;
          
          const programId = accountStrs[programIdIndex];
          if (programId === AMM_PROGRAM) {
            ammInstructionIndex = i;
            ammInstruction = ix;
            break;
          }
        }
        
        if (!ammInstruction) return;
        
        // Decode instruction type
        const dataBuffer = Buffer.from(ammInstruction.data, 'base64');
        const isBuy = dataBuffer.subarray(0, 8).equals(DISCRIMINATORS.BUY);
        const isSell = dataBuffer.subarray(0, 8).equals(DISCRIMINATORS.SELL);
        
        if (!isBuy && !isSell) return;
        
        // Parse slippage parameters
        let slippageParams: any = {};
        if (isBuy) {
          slippageParams = {
            baseAmountOut: readUInt64LE(dataBuffer, 8),
            maxQuoteAmountIn: readUInt64LE(dataBuffer, 16)
          };
        } else {
          slippageParams = {
            baseAmountIn: readUInt64LE(dataBuffer, 8),
            minQuoteAmountOut: readUInt64LE(dataBuffer, 16)
          };
        }
        
        // Get actual amounts from inner instructions
        const actualAmounts = extractActualAmounts(
          meta?.innerInstructions || [],
          ammInstructionIndex,
          accountStrs,
          isBuy,
          slippageParams
        );
        
        if (!actualAmounts) return;
        
        transactionsAnalyzed++;
        
        // Display comparison
        console.log(chalk.green(`\n✅ ${isBuy ? 'BUY' : 'SELL'} Transaction Analyzed`));
        console.log(chalk.gray('─'.repeat(40)));
        console.log(`Signature: ${chalk.blue(bs58.encode(tx.signatures[0]).slice(0, 20))}...`);
        
        if (isBuy) {
          console.log(chalk.yellow('\n📋 Slippage Parameters:'));
          console.log(`  base_amount_out: ${slippageParams.baseAmountOut} (expected tokens)`);
          console.log(`  max_quote_amount_in: ${slippageParams.maxQuoteAmountIn} (max SOL)`);
          
          console.log(chalk.green('\n💰 Actual Amounts:'));
          console.log(`  SOL paid: ${actualAmounts.solAmount} (${Number(actualAmounts.solAmount) / 1e9} SOL)`);
          console.log(`  Tokens received: ${actualAmounts.tokenAmount}`);
          
          const slippagePct = Number(actualAmounts.solAmount) / Number(slippageParams.maxQuoteAmountIn) * 100;
          console.log(chalk.cyan(`\n📊 Used ${slippagePct.toFixed(2)}% of max slippage`));
        } else {
          console.log(chalk.yellow('\n📋 Slippage Parameters:'));
          console.log(`  base_amount_in: ${slippageParams.baseAmountIn} (tokens to sell)`);
          console.log(`  min_quote_amount_out: ${slippageParams.minQuoteAmountOut} (min SOL)`);
          
          console.log(chalk.green('\n💰 Actual Amounts:'));
          console.log(`  Tokens sold: ${actualAmounts.tokenAmount}`);
          console.log(`  SOL received: ${actualAmounts.solAmount} (${Number(actualAmounts.solAmount) / 1e9} SOL)`);
          
          const slippageBonus = (Number(actualAmounts.solAmount) - Number(slippageParams.minQuoteAmountOut)) / Number(slippageParams.minQuoteAmountOut) * 100;
          console.log(chalk.cyan(`\n📊 Got ${slippageBonus.toFixed(2)}% more than min slippage`));
        }
        
        results.push({
          type: isBuy ? 'BUY' : 'SELL',
          slippageParams,
          actualAmounts,
          signature: bs58.encode(tx.signatures[0])
        });
        
        // Stop after analyzing enough transactions
        if (transactionsAnalyzed >= 10) {
          console.log(chalk.green('\n\n✅ Analysis complete!'));
          console.log(`Analyzed ${transactionsAnalyzed} AMM transactions`);
          
          // Summary
          console.log(chalk.blue('\n📊 Summary:'));
          console.log(chalk.gray('─'.repeat(40)));
          const buys = results.filter(r => r.type === 'BUY');
          const sells = results.filter(r => r.type === 'SELL');
          console.log(`BUY transactions: ${buys.length}`);
          console.log(`SELL transactions: ${sells.length}`);
          
          stream.end();
          process.exit(0);
        }
      } catch (error) {
        console.error(chalk.red('Error processing transaction:'), error);
      }
    }
  });
  
  // Subscribe to AMM transactions
  const subscribeRequest = {
    slots: {},
    accounts: {},
    transactions: {
      amm: {
        vote: false,
        failed: false,
        accountInclude: [AMM_PROGRAM],
        accountExclude: [],
        accountRequired: []
      }
    },
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    commitment: CommitmentLevel.CONFIRMED,
    accountsDataSlice: [],
    ping: undefined
  };
  
  await new Promise<void>((resolve, reject) => {
    stream.write(subscribeRequest, (err: any) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
  
  console.log(chalk.green('✅ Subscribed to AMM transactions'));
  console.log(chalk.gray('Analyzing AMM trades...\n'));
}

function extractActualAmounts(
  innerInstructions: any[],
  mainInstructionIndex: number,
  accountStrs: string[],
  isBuy: boolean,
  slippageParams: any
): { solAmount: bigint, tokenAmount: bigint } | null {
  // Find inner instructions for our main instruction
  const innerIxGroup = innerInstructions.find(group => group.index === mainInstructionIndex);
  if (!innerIxGroup?.instructions) return null;

  // Extract all transferChecked amounts
  const transfers: bigint[] = [];
  
  for (const innerIx of innerIxGroup.instructions) {
    const programIdIndex = innerIx.programIdIndex;
    if (programIdIndex >= accountStrs.length) continue;
    
    const programId = accountStrs[programIdIndex];
    if (programId !== TOKEN_PROGRAM_ID) continue;
    
    const data = Buffer.from(innerIx.data, 'base64');
    if (data.length > 0 && data[0] === 12) { // transferChecked
      if (data.length >= 9) {
        const amount = readUInt64LE(data, 1);
        transfers.push(amount);
      }
    }
  }
  
  if (transfers.length < 2) return null;
  
  // Simple heuristic: For trades, usually first transfer is input, one of the others is output
  if (isBuy) {
    // Buy: SOL in (small), tokens out (large)
    const smallestAmount = transfers.reduce((min, amt) => amt < min ? amt : min);
    const largestAmount = transfers.reduce((max, amt) => amt > max ? amt : max);
    
    return {
      solAmount: smallestAmount,
      tokenAmount: largestAmount
    };
  } else {
    // Sell: tokens in (matches base_amount_in), SOL out (small)
    const tokenAmount = slippageParams.baseAmountIn;
    const solAmount = transfers.find(amt => amt !== tokenAmount && amt < tokenAmount) || 0n;
    
    return {
      solAmount,
      tokenAmount
    };
  }
}

function readUInt64LE(buffer: Buffer, offset: number): bigint {
  if (offset + 8 > buffer.length) return 0n;
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    value += BigInt(buffer[offset + i]) << BigInt(i * 8);
  }
  return value;
}

// Run the verification
verifyAMMTransactions().catch(console.error);