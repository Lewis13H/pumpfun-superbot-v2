// src/monitor/utils/format.ts

import { PublicKey } from '@solana/web3.js';

export function bnLayoutFormatter(obj: any): void {
  if (!obj || typeof obj !== 'object') return;
  
  for (const key in obj) {
    if (obj[key] === null || obj[key] === undefined) continue;
    
    if (obj[key]?.constructor?.name === "PublicKey") {
      obj[key] = (obj[key] as PublicKey).toBase58();
    } else if (obj[key]?.constructor?.name === "BN") {
      obj[key] = Number(obj[key].toString());
    } else if (obj[key]?.constructor?.name === "BigInt") {
      obj[key] = Number(obj[key].toString());
    } else if (obj[key]?.constructor?.name === "Buffer") {
      obj[key] = (obj[key] as Buffer).toString("base64");
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      bnLayoutFormatter(obj[key]);
    }
  }
}

export function formatTokenAddress(address: string, length: number = 8): string {
  return `${address.substring(0, length)}...`;
}

export function formatPrice(price: number, decimals: number = 8): string {
  return price.toFixed(decimals);
}

export function formatMarketCap(marketCap: number): string {
  return `$${marketCap.toLocaleString()}`;
}
