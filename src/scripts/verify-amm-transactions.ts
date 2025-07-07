#\!/usr/bin/env npx tsx

/**
 * Verify AMM Transaction Amounts
 * Check actual AMM trade amounts from on-chain data
 */

import { Connection } from '@solana/web3.js';
import { createContainer } from '../core/container';
import { UnifiedDBService } from '../services/data-access/unified-db-service';
import { Logger } from '../core/logger';
import bs58 from 'bs58';

const logger = new Logger({ context: 'VerifyAMMTx' });

async function main() {
  const container = createContainer();
  const dbService = container.resolve<UnifiedDBService>('dbService');
  const connection = new Connection('https://api.mainnet-beta.solana.com');

  logger.info('🔍 Verifying AMM Transaction Amounts');

  try {
    // Get a specific recent AMM trade
    const recentTrades = await dbService.getRecentTrades(5, 'amm');
    
    for (const trade of recentTrades) {
      logger.info('\n' + '='.repeat(80));
      logger.info(`Analyzing trade: ${trade.signature.substring(0, 20)}...`);
      logger.info(`DB Values:`);
      logger.info(`  Trade Type: ${trade.trade_type}`);
      logger.info(`  Sol Amount: ${trade.sol_amount} (${Number(trade.sol_amount) / 1e9} SOL)`);
      logger.info(`  Token Amount: ${trade.token_amount}`);
      
      try {
        // Fetch full transaction with logs
        const tx = await connection.getTransaction(trade.signature, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed'
        });

        if (\!tx || \!tx.transaction || \!tx.transaction.message) {
          logger.warn('Could not fetch transaction');
          continue;
        }

        // Look for AMM instruction
        const message = tx.transaction.message;
        const instructions = message.instructions;
        const accountKeys = message.accountKeys;

        for (let i = 0; i < instructions.length; i++) {
          const ix = instructions[i];
          const programId = accountKeys[ix.programIdIndex];
          const programIdStr = programId.toBase58();
          
          // Check if it's AMM program
          if (programIdStr === 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA' && ix.data) {
            const dataBytes = Buffer.from(bs58.decode(ix.data));
            logger.info(`\nAMM Instruction found:`);
            logger.info(`  Data (hex): ${dataBytes.toString('hex')}`);
            logger.info(`  Data length: ${dataBytes.length} bytes`);
            
            const discriminator = dataBytes[0];
            const amount1 = readUInt64LE(dataBytes, 1);
            const amount2 = readUInt64LE(dataBytes, 9);
            
            logger.info(`  Discriminator: ${discriminator} (${discriminator === 51 ? 'BUY' : discriminator === 102 ? 'SELL' : 'UNKNOWN'})`);
            logger.info(`  Amount 1: ${amount1} (${Number(amount1) / 1e9} SOL)`);
            logger.info(`  Amount 2: ${amount2} (${Number(amount2) / 1e9} SOL)`);
          }
        }

        // Look for ray_log in logs
        if (tx.meta && tx.meta.logMessages) {
          for (const log of tx.meta.logMessages) {
            if (log.includes('ray_log:')) {
              logger.info(`\nFound ray_log:`);
              const match = log.match(/ray_log:\s*([A-Za-z0-9+/=]+)/);
              if (match) {
                const rayData = Buffer.from(match[1], 'base64');
                logger.info(`  Ray log data (hex): ${rayData.toString('hex')}`);
                logger.info(`  Ray log length: ${rayData.length} bytes`);
                
                // Parse amounts from ray_log
                if (rayData.length >= 24) {
                  const logAmount1 = readUInt64LE(rayData, 0);
                  const logAmount2 = readUInt64LE(rayData, 8);
                  const logAmount3 = readUInt64LE(rayData, 16);
                  
                  logger.info(`  Log Amount 1: ${logAmount1} (${Number(logAmount1) / 1e9} SOL)`);
                  logger.info(`  Log Amount 2: ${logAmount2} (${Number(logAmount2) / 1e9} SOL)`);
                  logger.info(`  Log Amount 3: ${logAmount3} (${Number(logAmount3) / 1e9} SOL)`);
                }
              }
            }
            
            // Also look for specific amount logs
            if (log.includes('amount') || log.includes('Swap') || log.includes('Transfer')) {
              logger.info(`  Log: ${log}`);
            }
          }
        }

        // Check pre/post token balances to verify actual amounts
        if (tx.meta && tx.meta.preTokenBalances && tx.meta.postTokenBalances) {
          logger.info(`\nToken Balance Changes:`);
          
          const preBalances = tx.meta.preTokenBalances;
          const postBalances = tx.meta.postTokenBalances;
          
          // Find user's token account changes
          for (let i = 0; i < preBalances.length; i++) {
            const pre = preBalances[i];
            const post = postBalances.find(p => p.accountIndex === pre.accountIndex);
            
            if (post && pre.uiTokenAmount.uiAmount \!== post.uiTokenAmount.uiAmount) {
              const change = post.uiTokenAmount.uiAmount - pre.uiTokenAmount.uiAmount;
              const mint = pre.mint;
              logger.info(`  Account ${pre.accountIndex}: ${change > 0 ? '+' : ''}${change} ${mint.substring(0, 6)}...`);
              
              // If it's SOL wrapped token
              if (mint === 'So11111111111111111111111111111111111111112') {
                logger.info(`    = ${Math.abs(change)} SOL ${change > 0 ? 'received' : 'sent'}`);
              }
            }
          }
        }

      } catch (error) {
        logger.error('Error analyzing transaction', { error });
      }
    }

  } catch (error) {
    logger.error('Script failed', { error });
  } finally {
    await dbService.close();
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

main().catch(console.error);
EOF < /dev/null