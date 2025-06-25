import { PriceData } from './price-calculator';

export function formatOutput(mint: string, priceData: PriceData): void {
  console.log(`Token Found: ${mint}`);
  console.log(`Price: ${priceData.priceInSol.toFixed(9)} SOL ($${priceData.priceInUsd.toFixed(6)})`);
  console.log(`Market Cap: ${priceData.mcapSol.toLocaleString('en-US', { maximumFractionDigits: 0 })} SOL ($${priceData.mcapUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })})`);
  console.log('---');
}