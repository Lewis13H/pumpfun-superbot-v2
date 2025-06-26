#!/usr/bin/env node
import 'dotenv/config';
import { db } from '../database';
import { batchGetTokenCreationTimes } from '../utils/token-age';

async function updateTokenAges() {
  console.log('🕒 Updating Token Creation Times\n');
  
  try {
    // Get all tokens that don't have accurate creation times
    const result = await db.query(`
      SELECT address, name, symbol, created_at
      FROM tokens
      ORDER BY created_at DESC
    `);
    
    if (result.rows.length === 0) {
      console.log('No tokens found to update.');
      return;
    }
    
    console.log(`Found ${result.rows.length} tokens to check\n`);
    
    // Get creation times from blockchain
    const addresses = result.rows.map((row: any) => row.address);
    const creationTimes = await batchGetTokenCreationTimes(addresses);
    
    // Update tokens with accurate creation times
    let updated = 0;
    for (const token of result.rows) {
      const blockchainTime = creationTimes.get(token.address);
      
      if (blockchainTime) {
        const dbTime = new Date(token.created_at);
        const timeDiff = Math.abs(dbTime.getTime() - blockchainTime.getTime());
        
        // Only update if there's a significant difference (more than 1 hour)
        if (timeDiff > 3600000) {
          await db.query(
            'UPDATE tokens SET created_at = $1 WHERE address = $2',
            [blockchainTime, token.address]
          );
          
          console.log(`✅ Updated ${token.symbol || token.address}: ${blockchainTime.toISOString()}`);
          updated++;
        } else {
          console.log(`⏭️  ${token.symbol || token.address}: Already accurate`);
        }
      } else {
        console.log(`❌ ${token.symbol || token.address}: Could not fetch creation time`);
      }
    }
    
    console.log(`\n✨ Updated ${updated} tokens with accurate creation times`);
    
  } catch (error) {
    console.error('Error updating token ages:', error);
  } finally {
    await db.close();
  }
}

updateTokenAges().catch(console.error);