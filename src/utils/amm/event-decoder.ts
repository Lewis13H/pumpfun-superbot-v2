/**
 * Direct decoder for AMM events from Program data logs
 * Workaround for IDL compatibility issues with Anchor
 */

import { Buffer } from 'buffer';

// Event discriminators from the IDL
const BUY_EVENT_DISCRIMINATOR = [103, 244, 82, 31, 44, 245, 119, 119];
const SELL_EVENT_DISCRIMINATOR = [62, 47, 55, 10, 165, 3, 220, 42];

export interface AmmEventData {
  timestamp: bigint;
  base_amount_out?: bigint;  // For buy events
  base_amount_in?: bigint;   // For sell events
  max_quote_amount_in?: bigint;
  max_quote_amount_out?: bigint;
  user_base_token_reserves: bigint;
  user_quote_token_reserves: bigint;
  pool_base_token_reserves: bigint;
  pool_quote_token_reserves: bigint;
  quote_amount_in?: bigint;
  quote_amount_out?: bigint;
  lp_fee_basis_points: bigint;
  lp_fee: bigint;
  protocol_fee_basis_points: bigint;
  protocol_fee: bigint;
  quote_amount_in_with_lp_fee?: bigint;
  quote_amount_out_with_lp_fee?: bigint;
  user_quote_amount_in?: bigint;
  user_quote_amount_out?: bigint;
}

export function decodeAmmEventFromLog(logMessage: string): { name: string; data: AmmEventData } | null {
  if (!logMessage.startsWith('Program data: ')) {
    return null;
  }

  try {
    const base64Data = logMessage.replace('Program data: ', '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Check discriminator (first 8 bytes)
    const discriminator = Array.from(buffer.slice(0, 8));
    
    // The actual buy event discriminator might be slightly different
    const ACTUAL_BUY_DISCRIMINATOR = [103, 244, 82, 31, 44, 181, 119, 119];
    
    let eventName: string;
    if (discriminator.every((b, i) => b === ACTUAL_BUY_DISCRIMINATOR[i])) {
      eventName = 'BuyEvent';
    } else if (discriminator.every((b, i) => b === BUY_EVENT_DISCRIMINATOR[i])) {
      eventName = 'BuyEvent';
    } else if (discriminator.every((b, i) => b === SELL_EVENT_DISCRIMINATOR[i])) {
      eventName = 'SellEvent';
    } else {
      console.log('Unknown discriminator:', discriminator);
      return null;
    }

    // Parse the event data (all fields are u64 = 8 bytes each)
    let offset = 8; // Skip discriminator
    
    const readU64 = (): bigint => {
      const value = buffer.readBigUInt64LE(offset);
      offset += 8;
      return value;
    };

    // Common fields for both Buy and Sell events
    const timestamp = readU64();
    const base_amount = readU64(); // base_amount_out for buy, base_amount_in for sell
    const max_quote_amount = readU64(); // max_quote_amount_in for buy, max_quote_amount_out for sell
    const user_base_token_reserves = readU64();
    const user_quote_token_reserves = readU64();
    const pool_base_token_reserves = readU64();
    const pool_quote_token_reserves = readU64();
    const quote_amount = readU64(); // quote_amount_in for buy, quote_amount_out for sell
    const lp_fee_basis_points = readU64();
    const lp_fee = readU64();
    const protocol_fee_basis_points = readU64();
    const protocol_fee = readU64();
    const quote_amount_with_lp_fee = readU64();
    const user_quote_amount = readU64(); // user_quote_amount_in for buy, user_quote_amount_out for sell

    const data: AmmEventData = {
      timestamp,
      user_base_token_reserves,
      user_quote_token_reserves,
      pool_base_token_reserves,
      pool_quote_token_reserves,
      lp_fee_basis_points,
      lp_fee,
      protocol_fee_basis_points,
      protocol_fee,
    };

    if (eventName === 'BuyEvent') {
      data.base_amount_out = base_amount;
      data.max_quote_amount_in = max_quote_amount;
      data.quote_amount_in = quote_amount;
      data.quote_amount_in_with_lp_fee = quote_amount_with_lp_fee;
      data.user_quote_amount_in = user_quote_amount;
    } else {
      data.base_amount_in = base_amount;
      data.max_quote_amount_out = max_quote_amount;
      data.quote_amount_out = quote_amount;
      data.quote_amount_out_with_lp_fee = quote_amount_with_lp_fee;
      data.user_quote_amount_out = user_quote_amount;
    }

    return { name: eventName, data };
  } catch (error) {
    console.error('Failed to decode AMM event:', error);
    return null;
  }
}

export function extractAmmEventsFromLogs(logMessages: string[]): Array<{ name: string; data: AmmEventData }> {
  const events: Array<{ name: string; data: AmmEventData }> = [];
  
  for (const log of logMessages) {
    const event = decodeAmmEventFromLog(log);
    if (event) {
      events.push(event);
    }
  }
  
  return events;
}