import { PriceData } from './price-calculator';

export function formatOutput(mint: string, priceData: PriceData): void {
  console.log(`Token Found: ${mint}`);
  console.log(`Price: ${priceData.priceInSol.toFixed(9)} SOL ($${priceData.priceInUsd.toFixed(6)})`);
  console.log(`Market Cap: ${priceData.mcapSol.toLocaleString('en-US', { maximumFractionDigits: 0 })} SOL ($${priceData.mcapUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })})`);
  console.log('---');
}

export function formatPrice(priceInSol: number, solPriceUsd: number): string {
  const priceUsd = priceInSol * solPriceUsd;
  return `${priceInSol.toFixed(9)} SOL ($${priceUsd.toFixed(6)})`;
}

export function formatTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

export function formatProgress(virtualSolReserves: bigint): string {
  const reservesInSol = Number(virtualSolReserves) / 1e9;
  const progress = ((reservesInSol - 30) / (85 - 30)) * 100;
  const clampedProgress = Math.max(0, Math.min(100, progress));
  
  const filled = Math.floor(clampedProgress / 5);
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
  
  return `[${bar}] ${clampedProgress.toFixed(1)}% (${reservesInSol.toFixed(1)}/85 SOL)`;
}