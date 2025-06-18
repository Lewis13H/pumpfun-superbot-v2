import { Connection, PublicKey } from '@solana/web3.js';
import { db } from '../src/database';
import { config } from '../src/config';

const connection = new Connection(config.rpc.endpoint, 'confirmed');

async function recoverBondingCurves() {
  console.log('🔧 Starting bonding curve recovery...');
  
  // Get all tokens with unknown bonding curves
  const result = await db.query(`
    SELECT address, creation_signature, symbol 
    FROM tokens 
    WHERE bonding_curve = 'unknown' 
      AND creation_signature IS NOT NULL
    ORDER BY created_at DESC
  `);
  
  console.log(`Found ${result.rows.length} tokens to recover`);
  
  let recovered = 0;
  let failed = 0;
  
  for (const token of result.rows) {
    try {
      console.log(`\n🔍 Processing ${token.symbol} (${token.address.substring(0, 8)}...)`);
      
      // Fetch the transaction
      const tx = await connection.getTransaction(token.creation_signature, {
        maxSupportedTransactionVersion: 0
      });
      
      if (!tx) {
        console.log('❌ Transaction not found');
        failed++;
        continue;
      }
      
      // Look for pump.fun instruction
      let bondingCurve = null;
      
      // Find pump.fun program in account keys
      const pumpIndex = tx.transaction.message.accountKeys.findIndex(
        key => key.toBase58() === '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
      );
      
      if (pumpIndex !== -1) {
        // Look for create instruction
        for (const ix of tx.transaction.message.instructions) {
          if (ix.programIdIndex === pumpIndex) {
            // Create instruction typically has bonding curve at account index 2
            if (ix.accounts.length >= 3) {
              const bcIndex = ix.accounts[2];
              bondingCurve = tx.transaction.message.accountKeys[bcIndex].toBase58();
              break;
            }
          }
        }
      }
      
      if (bondingCurve && bondingCurve !== 'unknown') {
        console.log(`✅ Found bonding curve: ${bondingCurve}`);
        
        // Update the database
        await db.query(
          'UPDATE tokens SET bonding_curve = $1 WHERE address = $2',
          [bondingCurve, token.address]
        );
        
        recovered++;
      } else {
        console.log('❌ Could not find bonding curve');
        failed++;
      }
      
      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`❌ Error processing ${token.address}:`, error);
      failed++;
    }
  }
  
  console.log(`\n✅ Recovery complete!`);
  console.log(`   Recovered: ${recovered}`);
  console.log(`   Failed: ${failed}`);
}

// Run the recovery
recoverBondingCurves()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });