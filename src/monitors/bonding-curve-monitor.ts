#!/usr/bin/env node
import 'dotenv/config';
import { AccountSubscriptionHandler } from '../stream/account-subscription';
import { SolPriceService } from '../services/sol-price';

async function main() {
  console.log('🚀 Pump.fun Bonding Curve Progress Monitor');
  console.log('📊 Streaming bonding curve updates...');
  console.log('⌨️  Press Ctrl+C to stop\n');
  
  const handler = new AccountSubscriptionHandler();
  const solPriceService = SolPriceService.getInstance();
  
  // Initialize SOL price service
  await solPriceService.initialize();
  
  // Set up callback for updates
  handler.onUpdate((bondingCurve) => {
    const progressBar = createProgressBar(bondingCurve.progress);
    const status = bondingCurve.complete ? '✅ COMPLETED' : '🔄 ACTIVE';
    
    console.log(`
📊 Bonding Curve Update
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Address: ${bondingCurve.pubkey}
Progress: ${progressBar} ${bondingCurve.progress.toFixed(1)}%
Liquidity: ${bondingCurve.realSolInSol.toFixed(4)} / 85 SOL
Status: ${status}
Virtual Price: ${bondingCurve.virtualPriceInSol.toFixed(8)} SOL

Real Reserves:
  - SOL: ${(Number(bondingCurve.realSolReserves) / 1e9).toFixed(6)}
  - Tokens: ${(Number(bondingCurve.realTokenReserves) / 1e6).toFixed(0)}

Virtual Reserves:
  - SOL: ${(Number(bondingCurve.virtualSolReserves) / 1e9).toFixed(6)}
  - Tokens: ${(Number(bondingCurve.virtualTokenReserves) / 1e6).toFixed(0)}

${bondingCurve.complete ? '🎉 This token has migrated to Raydium!' : ''}
${!bondingCurve.complete && bondingCurve.progress > 90 ? '⚠️  Close to migration!' : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
  });
  
  // Set up graceful shutdown
  const shutdown = async () => {
    console.log('\n\n🛑 Shutting down gracefully...');
    await handler.stop();
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);
  
  try {
    await handler.start();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

function createProgressBar(progress: number): string {
  const filled = Math.floor(progress / 5);
  const empty = 20 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

main().catch(console.error);