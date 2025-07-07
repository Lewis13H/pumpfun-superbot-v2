#!/usr/bin/env npx tsx

/**
 * Check Single AMM Transaction
 * Analyze a specific AMM transaction to understand the data
 */

import { Connection } from '@solana/web3.js';
import { Logger } from '../core/logger';
import chalk from 'chalk';
import bs58 from 'bs58';

const logger = new Logger({ context: 'CheckAMMTx' });

// Known AMM transaction from pump.swap
const AMM_TX = '2zc7uohXUAqR2rayuS2PJmQMcP6yAfFvmb9eLGz8sNu7Pr1TuMSkiyfAhKobCXvynoTTsJ28C6nnyK8PLZ1whFs';

async function main() {
  console.log(chalk.cyan('\n🔍 Analyzing AMM Transaction\n'));
  
  const connection = new Connection('https://api.mainnet-beta.solana.com');
  
  try {
    const tx = await connection.getTransaction(AMM_TX, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed'
    });
    
    if (!tx) {
      console.log('Transaction not found');
      return;
    }
    
    console.log(chalk.yellow('Transaction:'), AMM_TX);
    console.log(chalk.yellow('Slot:'), tx.slot);
    
    // Check logs
    if (tx.meta?.logMessages) {
      console.log(chalk.cyan('\n📋 Logs:'));
      tx.meta.logMessages.forEach((log, i) => {
        if (!log.includes('invoke') && !log.includes('success') && log.length > 20) {
          console.log(`[${i}] ${log}`);
        }
      });
    }
    
    // Check token balance changes
    if (tx.meta?.preTokenBalances && tx.meta?.postTokenBalances) {
      console.log(chalk.green('\n💰 Token Balance Changes:'));
      
      const preBalances = tx.meta.preTokenBalances;
      const postBalances = tx.meta.postTokenBalances;
      
      for (const pre of preBalances) {
        const post = postBalances.find(p => p.accountIndex === pre.accountIndex);
        if (post && pre.uiTokenAmount.uiAmount !== post.uiTokenAmount.uiAmount) {
          const change = post.uiTokenAmount.uiAmount - pre.uiTokenAmount.uiAmount;
          console.log(`\nAccount ${pre.accountIndex} (${pre.owner?.substring(0, 8)}...):`);
          console.log(`  Mint: ${pre.mint}`);
          console.log(`  Change: ${change > 0 ? '+' : ''}${change.toFixed(6)}`);
          console.log(`  Decimals: ${pre.uiTokenAmount.decimals}`);
          
          if (pre.mint === 'So11111111111111111111111111111111111111112') {
            console.log(chalk.yellow(`  = ${Math.abs(change)} SOL ${change > 0 ? 'received' : 'sent'}`));
          }
        }
      }
    }
    
    // Check the instruction
    const message = tx.transaction.message;
    const instructions = message.instructions;
    
    console.log(chalk.magenta('\n📝 Instructions:'));
    instructions.forEach((ix, i) => {
      const programId = message.accountKeys[ix.programIdIndex].toBase58();
      if (programId === 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA') {
        console.log(`\n[${i}] AMM Instruction:`);
        console.log(`  Program: ${programId}`);
        console.log(`  Data: ${ix.data}`);
        
        const dataBytes = bs58.decode(ix.data);
        console.log(`  Data (hex): ${Buffer.from(dataBytes).toString('hex')}`);
        console.log(`  Data length: ${dataBytes.length} bytes`);
        
        // Parse instruction data
        const discriminator = dataBytes[0];
        console.log(`  Discriminator: ${discriminator} (${discriminator === 102 ? 'BUY' : discriminator === 51 ? 'SELL' : 'UNKNOWN'})`);
        
        if (dataBytes.length >= 17) {
          const amount1 = readUInt64LE(dataBytes, 1);
          const amount2 = readUInt64LE(dataBytes, 9);
          
          console.log(`  Amount 1: ${amount1} (${Number(amount1) / 1e9} SOL)`);
          console.log(`  Amount 2: ${amount2} (${Number(amount2) / 1e9} SOL)`);
        }
      }
    });
    
  } catch (error) {
    console.error('Error:', error);
  }
}

function readUInt64LE(buffer: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    value += BigInt(buffer[offset + i]) << BigInt(i * 8);
  }
  return value;
}

main();