#!/usr/bin/env npx tsx

/**
 * Test AMM Parser with Real Transaction Data
 * Fetches actual AMM transactions and verifies the parser works correctly
 */

import 'dotenv/config';
import chalk from 'chalk';
import { Connection } from '@solana/web3.js';
import { UnifiedAmmTradeStrategy } from '../utils/parsers/strategies/unified-amm-trade-strategy';
import { AMMTradeHeuristicStrategy } from '../utils/parsers/strategies/amm-trade-heuristic-strategy';
import { ParseContext, EventType } from '../utils/parsers/types';
import { AMM_PROGRAM } from '../utils/config/constants';
import { Pool } from 'pg';
import bs58 from 'bs58';

async function fetchRealAmmTransaction(signature: string): Promise<ParseContext | null> {
  try {
    const connection = new Connection(process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com');
    const tx = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed'
    });
    
    if (!tx) {
      console.error('Transaction not found');
      return null;
    }
    
    // Build parse context
    const context: ParseContext = {
      signature,
      slot: BigInt(tx.slot),
      blockTime: tx.blockTime || Date.now() / 1000,
      accounts: tx.transaction.message.accountKeys.map(k => k.toBase58()),
      logs: tx.meta?.logMessages || [],
      innerInstructions: tx.meta?.innerInstructions || [],
      data: undefined, // Will extract from instructions
      userAddress: undefined, // Will identify from transaction
      fullTransaction: { transaction: { transaction: tx } }
    };
    
    // Extract instruction data for AMM program
    const instructions = tx.transaction.message.instructions;
    for (const ix of instructions) {
      const programId = tx.transaction.message.accountKeys[ix.programIdIndex].toBase58();
      if (programId === AMM_PROGRAM) {
        context.data = Buffer.from(ix.data, 'base64');
        // First account is typically the user
        if (ix.accounts && ix.accounts.length > 0) {
          context.userAddress = tx.transaction.message.accountKeys[ix.accounts[0]].toBase58();
        }
        break;
      }
    }
    
    return context;
  } catch (error) {
    console.error('Error fetching transaction:', error);
    return null;
  }
}

async function testWithRealData() {
  console.log(chalk.cyan('\n🧪 Testing AMM Parser with Real Transaction Data\n'));
  
  // Test parsers
  const unifiedParser = new UnifiedAmmTradeStrategy();
  const heuristicParser = new AMMTradeHeuristicStrategy();
  
  // Known AMM transaction signatures from pump.swap
  const testSignatures = [
    // Recent pump.swap AMM trades (you can verify these on Solscan)
    '5C4z8PQFJYHLwmCgpHNkQvXcXGMJvUxK8uzQ7EStRdJzQKyBgvSbKnYcSxQYkPqNzVfxDgBVphDqYvRSpUmejNUg',
    '3YQm7ujtXWJU2e9jhp2QGHpnn3ShXn7mCbTX3FCp8uqAP5QiFqsJGZgKQYdCpfHTKYqpBBQHXEMwvty27s72oLcU'
  ];
  
  // If no hardcoded signatures, fetch from database
  if (testSignatures.length === 0) {
    console.log('Fetching recent AMM transactions from database...\n');
    
    const db = new Pool({
      connectionString: process.env.DATABASE_URL
    });
    const result = await db.query(`
      SELECT DISTINCT signature 
      FROM trades_unified 
      WHERE venue = 'pump_amm' 
      AND created_at > NOW() - INTERVAL '24 hours'
      LIMIT 10
    `);
    
    testSignatures.push(...result.rows.map(r => r.signature));
    
    if (testSignatures.length === 0) {
      // Fallback: get any transaction that touched AMM program
      const fallbackResult = await db.query(`
        SELECT signature 
        FROM raw_transactions 
        WHERE program_id = $1 
        AND created_at > NOW() - INTERVAL '24 hours'
        LIMIT 10
      `, [AMM_PROGRAM]);
      
      testSignatures.push(...fallbackResult.rows.map(r => r.signature));
    }
    
    await db.end();
  }
  
  if (testSignatures.length === 0) {
    console.log(chalk.red('No AMM transactions found to test with'));
    return;
  }
  
  console.log(`Found ${testSignatures.length} AMM transactions to test\n`);
  
  // Test each transaction
  let successCount = 0;
  let innerIxSuccessCount = 0;
  
  for (const [index, signature] of testSignatures.entries()) {
    console.log(chalk.yellow(`\nTest ${index + 1}/${testSignatures.length}: ${signature}`));
    console.log(`Solscan: https://solscan.io/tx/${signature}`);
    
    const context = await fetchRealAmmTransaction(signature);
    if (!context) {
      console.log(chalk.red('  Failed to fetch transaction'));
      continue;
    }
    
    // Verify it's an AMM transaction
    const canParseUnified = unifiedParser.canParse(context);
    const canParseHeuristic = heuristicParser.canParse(context);
    
    console.log(`  Can parse (Unified): ${canParseUnified ? chalk.green('YES') : chalk.red('NO')}`);
    console.log(`  Can parse (Heuristic): ${canParseHeuristic ? chalk.green('YES') : chalk.red('NO')}`);
    
    // Test unified parser
    console.log('\n  Testing Unified Parser:');
    const unifiedResult = unifiedParser.parse(context);
    
    if (unifiedResult) {
      successCount++;
      console.log(chalk.green('    ✅ SUCCESS'));
      console.log(`    Type: ${unifiedResult.tradeType}`);
      console.log(`    Mint: ${unifiedResult.mintAddress}`);
      console.log(`    SOL: ${(Number(unifiedResult.solAmount) / 1e9).toFixed(6)} SOL`);
      console.log(`    Tokens: ${unifiedResult.tokenAmount?.toString() || 'N/A'}`);
      console.log(`    Pool: ${unifiedResult.poolAddress}`);
      
      // Check if virtual reserves were populated
      if (unifiedResult.virtualSolReserves && unifiedResult.virtualSolReserves > 0n) {
        console.log(`    Virtual SOL Reserves: ${(Number(unifiedResult.virtualSolReserves) / 1e9).toFixed(2)} SOL`);
        console.log(`    Virtual Token Reserves: ${unifiedResult.virtualTokenReserves?.toString() || 'N/A'}`);
      }
      
      // Check inner instructions
      if (context.innerInstructions && context.innerInstructions.length > 0) {
        innerIxSuccessCount++;
        console.log(chalk.blue(`    Inner Instructions: ${context.innerInstructions.length} groups`));
        
        // Show first inner instruction group
        const firstGroup = context.innerInstructions[0];
        console.log(`    First group has ${firstGroup.instructions?.length || 0} instructions`);
      }
    } else {
      console.log(chalk.red('    ❌ FAILED to parse'));
      
      // Debug why it failed
      console.log('    Debug info:');
      console.log(`      Logs: ${context.logs?.length || 0}`);
      console.log(`      Inner IX: ${context.innerInstructions?.length || 0}`);
      console.log(`      Has data: ${!!context.data}`);
      
      if (context.logs && context.logs.length > 0) {
        console.log('      First few logs:');
        context.logs.slice(0, 3).forEach(log => {
          console.log(`        ${log.substring(0, 80)}...`);
        });
      }
    }
    
    // Test heuristic parser as fallback
    if (!unifiedResult && canParseHeuristic) {
      console.log('\n  Testing Heuristic Parser (fallback):');
      const heuristicResult = heuristicParser.parse(context);
      
      if (heuristicResult) {
        console.log(chalk.yellow('    ⚠️  HEURISTIC SUCCESS'));
        console.log(`    SOL: ${(Number(heuristicResult.solAmount) / 1e9).toFixed(6)} SOL`);
      } else {
        console.log(chalk.red('    ❌ HEURISTIC ALSO FAILED'));
      }
    }
  }
  
  // Summary
  console.log(chalk.cyan('\n\n📊 Test Summary:\n'));
  console.log(`Total transactions tested: ${testSignatures.length}`);
  console.log(`Successfully parsed: ${successCount} (${(successCount/testSignatures.length*100).toFixed(1)}%)`);
  console.log(`With inner instructions: ${innerIxSuccessCount} (${(innerIxSuccessCount/testSignatures.length*100).toFixed(1)}%)`);
  
  if (successCount === 0) {
    console.log(chalk.red('\n❌ Parser is not working correctly!'));
    console.log('Common issues:');
    console.log('- Event parser not initialized properly');
    console.log('- Log format changed');
    console.log('- Inner instruction parsing issues');
  } else if (successCount < testSignatures.length * 0.5) {
    console.log(chalk.yellow('\n⚠️  Parser needs improvement'));
    console.log(`Only ${successCount} out of ${testSignatures.length} transactions parsed successfully`);
  } else {
    console.log(chalk.green('\n✅ Parser is working well!'));
  }
}

// Run the test
testWithRealData().catch(console.error);