/**
 * Update Token Creators Script
 * Fetches creator addresses from bonding curve accounts for existing tokens
 */

import { Connection, PublicKey } from '@solana/web3.js';
import chalk from 'chalk';
import * as borsh from '@coral-xyz/borsh';
import { db } from '../database';

// Bonding curve schema
const BONDING_CURVE_SCHEMA = borsh.struct([
  borsh.u64('virtualTokenReserves'),
  borsh.u64('virtualSolReserves'),
  borsh.u64('realTokenReserves'),
  borsh.u64('realSolReserves'),
  borsh.u64('tokenTotalSupply'),
  borsh.bool('complete'),
  borsh.publicKey('creator'),
]);

const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

async function updateTokenCreators() {
  console.log(chalk.blue('\n🔍 Updating Token Creators\n'));
  
  const connection = new Connection(
    process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    'confirmed'
  );
  
  try {
    // Get tokens without creators
    const result = await db.query(`
      SELECT mint_address, symbol, name
      FROM tokens_unified
      WHERE (creator IS NULL OR creator = '' OR creator = '""')
      AND current_program = 'bonding_curve'
      ORDER BY latest_market_cap_usd DESC NULLS LAST
      LIMIT 50
    `);
    
    if (result.rows.length === 0) {
      console.log(chalk.green('✅ All bonding curve tokens have creators!'));
      return;
    }
    
    console.log(chalk.cyan(`Found ${result.rows.length} tokens without creators\n`));
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const token of result.rows) {
      console.log(chalk.white(`\n📍 Checking ${token.symbol || 'Unknown'} (${token.mint_address.slice(0, 8)}...)`));
      
      try {
        // Derive bonding curve address
        const [bondingCurve] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("bonding-curve"),
            new PublicKey(token.mint_address).toBuffer(),
          ],
          PUMP_PROGRAM
        );
        
        // Get account info
        const accountInfo = await connection.getAccountInfo(bondingCurve);
        
        if (!accountInfo) {
          console.log(chalk.yellow('   ⚠️  No bonding curve account found'));
          errorCount++;
          continue;
        }
        
        // Skip discriminator (8 bytes)
        const data = accountInfo.data.slice(8);
        
        // Parse bonding curve data
        const bcData = BONDING_CURVE_SCHEMA.decode(data);
        
        if (bcData.creator && bcData.creator !== '11111111111111111111111111111111') {
          // Update database
          await db.query(
            `UPDATE tokens_unified 
             SET creator = $2,
                 updated_at = NOW()
             WHERE mint_address = $1`,
            [token.mint_address, bcData.creator]
          );
          
          console.log(chalk.green(`   ✅ Updated creator: ${bcData.creator}`));
          console.log(chalk.gray(`      Complete: ${bcData.complete}`));
          console.log(chalk.gray(`      SOL Reserves: ${Number(bcData.virtualSolReserves) / 1e9}`));
          successCount++;
        } else {
          console.log(chalk.yellow('   ⚠️  No valid creator in bonding curve'));
          errorCount++;
        }
        
      } catch (error) {
        console.log(chalk.red(`   ❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
        errorCount++;
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(chalk.cyan('\n📊 Summary:'));
    console.log(chalk.green(`   ✅ Updated: ${successCount}`));
    console.log(chalk.red(`   ❌ Failed: ${errorCount}`));
    
    // Check remaining
    const remaining = await db.query(
      `SELECT COUNT(*) as count 
       FROM tokens_unified 
       WHERE (creator IS NULL OR creator = '' OR creator = '""')
       AND current_program = 'bonding_curve'`
    );
    
    if (remaining.rows[0].count > 0) {
      console.log(chalk.yellow(`\n⚠️  ${remaining.rows[0].count} tokens still need creators`));
    }
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await db.end();
  }
}

// Run the update
updateTokenCreators().catch(console.error);