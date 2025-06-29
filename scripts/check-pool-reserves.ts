#!/usr/bin/env tsx
import 'dotenv/config';
import { db } from '../src/database';

async function main() {
  const result = await db.query(`
    SELECT 
      mint_address, 
      pool_address, 
      virtual_sol_reserves, 
      virtual_token_reserves,
      created_at
    FROM amm_pool_states 
    ORDER BY created_at DESC
    LIMIT 10
  `);
  
  console.log('Recent pool states:');
  console.table(result.rows.map(r => ({
    mint: r.mint_address.slice(0, 8) + '...',
    pool: r.pool_address.slice(0, 8) + '...',
    sol_reserves: r.virtual_sol_reserves,
    token_reserves: r.virtual_token_reserves,
    created: r.created_at
  })));
  
  await db.close();
}

main().catch(console.error);