#!/usr/bin/env node

import 'dotenv/config';
import { db } from '../src/database';

async function main() {
  const result = await db.query(`
    SELECT 
      signature,
      program,
      trade_type,
      sol_amount::numeric/1e9 as sol,
      (sol_amount::numeric / 1e9 * 146.55) as value_usd,
      mint_address
    FROM trades_unified 
    WHERE (sol_amount::numeric / 1e9 * 146.55) > 1000 
    ORDER BY created_at DESC 
    LIMIT 5
  `);
  
  console.log('High value trades:');
  for (const row of result.rows) {
    console.log(`\nSignature: ${row.signature}`);
    console.log(`Value: $${Number(row.value_usd).toFixed(2)} (${Number(row.sol).toFixed(2)} SOL)`);
    console.log(`Type: ${row.program} - ${row.trade_type}`);
  }
  
  await db.close();
}

main().catch(console.error);