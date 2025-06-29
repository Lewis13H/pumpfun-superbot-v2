#!/usr/bin/env node

import 'dotenv/config';
import { db } from '../src/database';

async function main() {
  const result = await db.query(`
    SELECT 
      signature,
      trade_type,
      sol_amount::numeric/1e9 as sol,
      bonding_curve_progress,
      mint_address
    FROM trades_unified 
    WHERE program = 'bonding_curve'
    ORDER BY created_at DESC 
    LIMIT 1
  `);
  
  if (result.rows.length > 0) {
    const row = result.rows[0];
    console.log(`Signature: ${row.signature}`);
  }
  
  await db.close();
}

main().catch(console.error);