// src/monitor/constants.ts

import { Buffer } from 'buffer';

// Program IDs
export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// Instruction discriminators
export const DISCRIMINATORS = {
  CREATE: Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]),
  BUY: Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]),
  SELL: Buffer.from([51, 230, 133, 164, 1, 127, 131, 173])
};

// Trading constants
export const GRADUATION_TARGET_SOL = 85;
export const MAX_MARKET_CAP_USD = 10_000_000; // $10M safety limit
export const DEFAULT_SOL_PRICE = 150;
export const DEFAULT_TOKEN_DECIMALS = 6;
export const DEFAULT_TOKEN_SUPPLY = 1_000_000_000; // 1 billion

// Progress milestones
export const PROGRESS_MILESTONES = [10, 25, 50, 75, 90, 95, 99];

// Event sizes
export const TRADE_EVENT_SIZE = 225; // bytes

// Cache settings
export const CACHE_CLEANUP_INTERVAL = 300000; // 5 minutes
export const METADATA_CACHE_TTL = 3600000; // 1 hour

// API endpoints
export const COINGECKO_API_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd';
export const COINGECKO_TIMEOUT = 5000; // 5 seconds

// Buffer settings
export const DEFAULT_FLUSH_INTERVAL = 10000; // 10 seconds
export const DEFAULT_BATCH_SIZE = 50;
